import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { hashPassword, verifyPassword } from './password';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface TokenPayload {
  sub: string;
  /**
   * The account's tokenVersion when the token was issued. Tokens from before
   * the column existed have none and count as version 0.
   */
  ver?: number;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Same message either way so the endpoint does not reveal which emails exist.
    if (!user || !(await verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    return this.issue(user);
  }

  async me(userId: string): Promise<PublicUser> {
    return toPublicUser(await this.find(userId));
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
      data.email = dto.email;
    }
    if (Object.keys(data).length === 0) {
      return toPublicUser(user);
    }
    const updated = await this.prisma.user.update({ where: { id: userId }, data });
    if (data.email) {
      // A reset link that is still out was mailed to the old address.
      await this.prisma.passwordReset.deleteMany({ where: { userId } });
    }
    return toPublicUser(updated);
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
    // A reset link that is still out has no business working after this.
    await this.prisma.passwordReset.deleteMany({ where: { userId } });
    return this.issue(updated);
  }

  /** Makes every token issued so far worthless, the caller's included. */
  async logoutEverywhere(userId: string): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
  }

  /** Notebooks, notes, tags, versions and share links go with the user (cascades in the schema). */
  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<void> {
    const user = await this.find(userId);
    await this.checkPassword(user, dto.password, 'Password is incorrect');
    await this.prisma.user.delete({ where: { id: userId } });
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
    return { token: await this.jwt.signAsync(payload), user: toPublicUser(user) };
  }
}
