import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { AttachmentsService } from '../attachments/attachments.service';
import type { Prisma, User } from '@prisma/client';
import type { AuthUser } from '../common/current-user.decorator';
import { templateNotes } from '../notes/note-scope';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { EmailChangeService } from './email-change.service';
import { hashPassword, verifyPassword } from './password';
import { Preferences, readPreferences } from './preferences';
import { TwoStepService } from './two-step.service';

/** How long the ticket from the password step is good for the code step. */
export const TICKET_TTL_SECONDS = 5 * 60;
const TICKET_PURPOSE = 'two-step';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  /** Choices kept with the account, so they are the same on every device. */
  preferences: Preferences;
  /** Whether signing in asks for a code from an authenticator app. */
  twoStep: boolean;
  /** A new address that waits for its link to be opened, or null. */
  pendingEmail: string | null;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

/**
 * What the right password gets when codes are on: no token yet, a ticket
 * for POST /auth/login/code that is good for five minutes and a few codes.
 */
export interface TwoStepTicket {
  twoStep: true;
  ticket: string;
}

interface TicketPayload {
  sub: string;
  ver: number;
  purpose: typeof TICKET_PURPOSE;
  jti: string;
  exp?: number;
}

export interface TokenPayload {
  sub: string;
  /**
   * The account's tokenVersion when the token was issued. Tokens from before
   * the column existed have none and count as version 0.
   */
  ver?: number;
  /** Only on a two-step ticket, which is never a login token. */
  purpose?: string;
}

export function toPublicUser(user: User, pendingEmail: string | null = null): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    preferences: readPreferences(user.preferences),
    twoStep: (user.twoStepSince ?? null) !== null,
    pendingEmail,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Optional() private readonly attachments?: AttachmentsService,
    @Optional() private readonly twoStep?: TwoStepService,
    @Optional() private readonly emailChanges?: EmailChangeService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const user = await this.prisma.user.create({
      data: { email: dto.email, name: dto.name, passwordHash: await hashPassword(dto.password) },
    });
    return this.issue(user);
  }

  async login(dto: LoginDto): Promise<AuthResult | TwoStepTicket> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Same message either way so the endpoint does not reveal which emails exist.
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    if (this.twoStep?.isOn(user)) {
      const payload: TicketPayload = {
        sub: user.id,
        ver: user.tokenVersion,
        purpose: TICKET_PURPOSE,
        jti: randomUUID(),
      };
      return { twoStep: true, ticket: await this.jwt.signAsync(payload, { expiresIn: TICKET_TTL_SECONDS }) };
    }
    return this.issue(user);
  }

  /**
   * The second step: the ticket from the password and a code from the app
   * or a recovery code. A ticket stops working when the password changes or
   * every session is ended, like a token, and after a few wrong codes.
   */
  async loginWithCode(ticket: string, code: string, address: string, now = new Date()): Promise<AuthResult> {
    const expired = new UnauthorizedException('Sign in with your password again: that took too long.');
    let payload: TicketPayload;
    try {
      payload = await this.jwt.verifyAsync<TicketPayload>(ticket);
    } catch {
      throw expired;
    }
    if (payload.purpose !== TICKET_PURPOSE || !payload.jti || !this.twoStep) {
      throw expired;
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.tokenVersion !== payload.ver || !this.twoStep.isOn(user)) {
      throw expired;
    }
    this.twoStep.attempts.take(user.id, address, payload.jti, (payload.exp ?? 0) * 1000, now.getTime());
    if (!(await this.twoStep.check(user, code, now))) {
      this.twoStep.warnOwner(user, now.getTime());
      // 403, not 401: the web app signs out on a 401, and the ticket may have codes left.
      throw new ForbiddenException('That code is not right');
    }
    this.twoStep.attempts.giveBack(user.id, address);
    return this.issue(user);
  }

  async me(userId: string): Promise<PublicUser> {
    return this.publicUser(await this.find(userId));
  }

  /** Signs the caller in again after the token version was bumped for them, as turning codes on does. */
  async renew(userId: string): Promise<AuthResult> {
    return this.issue(await this.find(userId));
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    const user = await this.find(userId);
    const data: { name?: string; email?: string } = {};
    if (dto.name !== undefined && dto.name !== user.name) {
      data.name = dto.name;
    }
    if (dto.email !== undefined && dto.email !== user.email) {
      // The email is the login name, so changing it takes the password.
      if (!dto.currentPassword) {
        throw new BadRequestException('currentPassword is required to change the email');
      }
      await this.checkPassword(user, dto.currentPassword, 'Current password is incorrect');
      if (await this.prisma.user.findUnique({ where: { email: dto.email } })) {
        throw new ConflictException('An account with this email already exists');
      }
      if (this.emailChanges?.confirms) {
        // The new address waits for its link. The name, if sent too, changes now.
        await this.emailChanges.request(user, dto.email);
      } else {
        data.email = dto.email;
      }
    }
    if (Object.keys(data).length === 0) {
      return this.publicUser(user);
    }
    const updated = await this.prisma.user.update({ where: { id: userId }, data });
    if (data.email) {
      // A reset link that is still out was mailed to the old address.
      await this.prisma.passwordReset.deleteMany({ where: { userId } });
    }
    return this.publicUser(updated);
  }

  /**
   * Changes the preferences that were sent and leaves the others alone. A
   * notebook or a template that is named has to be the user's own, and the
   * template has to be one.
   */
  async updatePreferences(userId: string, dto: UpdatePreferencesDto): Promise<Preferences> {
    const user = await this.find(userId);
    const preferences = readPreferences(user.preferences);
    const daily = { ...preferences.dailyNotes };
    const sent = dto.dailyNotes ?? {};
    if (sent.notebookId !== undefined) {
      if (sent.notebookId && !(await this.prisma.notebook.findFirst({ where: { id: sent.notebookId, userId } }))) {
        throw new BadRequestException('There is no such notebook');
      }
      daily.notebookId = sent.notebookId;
    }
    if (sent.templateId !== undefined) {
      const where = { ...templateNotes(userId), id: sent.templateId ?? undefined };
      if (sent.templateId && !(await this.prisma.note.findFirst({ where }))) {
        throw new BadRequestException('There is no such template');
      }
      daily.templateId = sent.templateId;
    }
    if (sent.dateFormat !== undefined) daily.dateFormat = sent.dateFormat;

    const next: Preferences = { ...preferences, dailyNotes: daily };
    const saved = await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: next as unknown as Prisma.InputJsonObject },
    });
    // The answer is what the next read gives, and not what was put together above.
    return readPreferences(saved.preferences);
  }

  /**
   * Ends every other session along with the old password. The caller gets a
   * token for the new version, so the session that made the change goes on.
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<AuthResult> {
    const user = await this.find(userId);
    await this.checkPassword(user, dto.currentPassword, 'Current password is incorrect');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(dto.newPassword), tokenVersion: { increment: 1 } },
    });
    // A reset link that is still out has no business working after this,
    // nor a new address asked for in a session that may not have been the owner's.
    await this.prisma.passwordReset.deleteMany({ where: { userId } });
    await this.emailChanges?.cancel(userId);
    return this.issue(updated);
  }

  /** Makes every token issued so far worthless, the caller's included, and cancels a new address that waits. */
  async logoutEverywhere(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
    await this.emailChanges?.cancel(userId);
  }

  /** Notebooks, notes, tags, versions and share links go with the user (cascades in the schema). */
  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.find(userId);
    await this.checkPassword(user, dto.password, 'Password is incorrect');
    const files = (await this.attachments?.idsOfNotes({ userId })) ?? [];
    await this.prisma.user.delete({ where: { id: userId } });
    // The rows went with the account. The files go now; the sweep takes whatever this misses.
    await this.attachments?.removeFiles(files);
  }

  /**
   * Whose login token this is, or null when it is forged, expired, from
   * before the account's token version was bumped, or of a deleted account.
   * The second half costs one primary-key lookup of two columns.
   */
  async identify(token: string): Promise<AuthUser | null> {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      return null;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { email: true, tokenVersion: true },
    });
    // A two-step ticket is signed with the same key, and is no login.
    if (payload.purpose !== undefined || !user || user.tokenVersion !== (payload.ver ?? 0)) {
      return null;
    }
    return { id: payload.sub, email: user.email };
  }

  /** For other routes that ask for the password again. Throws the same 403 as the ones here. */
  async assertPassword(userId: string, password: string): Promise<void> {
    await this.checkPassword(await this.find(userId), password, 'Current password is incorrect');
  }

  private async find(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * 403 rather than 401: the session is fine, the confirmation is not. The
   * web app signs out on any 401.
   */
  private async checkPassword(user: User, password: string, message: string): Promise<void> {
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new ForbiddenException(message);
    }
  }

  private async issue(user: User): Promise<AuthResult> {
    const payload: TokenPayload = { sub: user.id, ver: user.tokenVersion };
    return { token: await this.jwt.signAsync(payload), user: await this.publicUser(user) };
  }

  private async publicUser(user: User): Promise<PublicUser> {
    return toPublicUser(user, (await this.emailChanges?.pending(user.id)) ?? null);
  }
}
