import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/config';
import { MailService, OutgoingMail } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password';

/** How long the link in the mail works. */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;
/**
 * Links of one account that can be open at a time. While that many are out,
 * asking again sends nothing. With the hour above this caps the mail an
 * account can be sent at three an hour, whoever is asking.
 */
export const MAX_OPEN_RESET_LINKS = 3;

const LINK_NOT_VALID = 'This link does not work any more. Ask for a new one.';

/**
 * Only this hash is stored. The token has 256 random bits, so a fast hash is
 * enough: there is nothing to guess, unlike with a password.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Nothing in the mail comes from the account. Sign-up does not check that an
 * address belongs to whoever typed it, so a name or anything else stored
 * with the account would let a stranger pick part of a mail that this
 * server sends to someone else.
 */
export function resetMail(to: string, link: string): OutgoingMail {
  return {
    to,
    subject: 'Reset your Notes password',
    text: [
      'Hello,',
      '',
      'Someone asked to reset the password of the Notes account with this address. To choose a new password, open this link:',
      '',
      link,
      '',
      'The link works once, for an hour. If it was not you, ignore this mail. Your password stays as it is.',
      '',
    ].join('\n'),
  };
}

/** What went wrong, without the text of the error: "EENVELOPE 550", "ECONNECTION", "PrismaClientKnownRequestError". */
export function failureKind(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }
  const { code, responseCode, name } = error as { code?: unknown; responseCode?: unknown; name?: unknown };
  const parts = [code, responseCode].filter((part) => typeof part === 'string' || typeof part === 'number');
  if (parts.length > 0) {
    return parts.join(' ');
  }
  return typeof name === 'string' ? name : 'unknown';
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** False when the server has no SMTP settings. */
  get enabled(): boolean {
    return this.mail.enabled;
  }

  /**
   * Starts the work and returns without waiting for it, so the answer is the
   * same, and takes the same time, whether or not the address has an account.
   */
  request(email: string): void {
    this.assertEnabled();
    this.sendLink(email).catch((error: unknown) => {
      // An SMTP server's refusal often quotes the address it refused. That
      // must not sit in the ordinary log, so only the kind of failure does.
      this.logger.error(`Could not send a password reset mail (${failureKind(error)})`);
      this.logger.debug(`Reset mail failure in full: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  /**
   * Resolves to true when a mail went out.
   *
   * Asking again never cancels a link that is already out: anyone who knows
   * an address can ask, and could otherwise keep killing the owner's link
   * before it is used. Instead an account has a small number of links at a
   * time, and requests beyond that do nothing.
   */
  async sendLink(email: string, now = new Date()): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return false;
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(token);
    const added = await this.prisma.$transaction(async (tx) => {
      // Requests for one account wait for each other here. Without the lock
      // several at once would all count the links before any had added one.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
      await tx.passwordReset.deleteMany({ where: { expiresAt: { lte: now } } });
      const open = await tx.passwordReset.count({ where: { userId: user.id } });
      if (open >= MAX_OPEN_RESET_LINKS) {
        return false;
      }
      await tx.passwordReset.create({
        data: { userId: user.id, tokenHash, createdAt: now, expiresAt: new Date(now.getTime() + RESET_LINK_TTL_MS) },
      });
      return true;
    });
    if (!added) {
      return false;
    }

    try {
      // In the fragment, not the query: a fragment is not sent to the server,
      // so the token stays out of the access log of whatever serves the app.
      await this.mail.send(resetMail(user.email, `${this.config.appUrl}/reset-password#token=${token}`));
    } catch (error) {
      // Nobody has the token, so the row would only use up one of the few links.
      await this.prisma.passwordReset.deleteMany({ where: { tokenHash } });
      throw error;
    }
    return true;
  }

  /**
   * Sets the new password, signs the account out everywhere and revokes its
   * API tokens.
   *
   * The tokens go too because this is the way back into an account someone
   * else may have been in: whoever knew the old password could have made a
   * token, and the page this is called from has no login to show a list on.
   * A password change in Settings keeps them and shows them instead.
   *
   * Two-step sign-in stays as it was. The reset signs nobody in, and the
   * next sign-in asks for a code as before, so a reset by mail is no way
   * around the code.
   */
  async reset(token: string, password: string, now = new Date()): Promise<void> {
    this.assertEnabled();
    const link = await this.prisma.passwordReset.findUnique({ where: { tokenHash: hashResetToken(token) } });
    if (!link || link.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(LINK_NOT_VALID);
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      // The same lock as in sendLink, so a link that is being added right now
      // is either removed below or belongs to a request made after this reset.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${link.userId}::uuid FOR UPDATE`;
      // Single use: of two requests with the same token only one finds the row.
      const used = await tx.passwordReset.deleteMany({ where: { id: link.id } });
      if (used.count !== 1) {
        throw new BadRequestException(LINK_NOT_VALID);
      }
      // The other links of the account stop working with this one.
      await tx.passwordReset.deleteMany({ where: { userId: link.userId } });
      await tx.apiToken.deleteMany({ where: { userId: link.userId } });
      // A new address asked for by whoever was in the account does not go through either.
      await tx.emailChange.deleteMany({ where: { userId: link.userId } });
      await tx.user.update({
        where: { id: link.userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
    });
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new NotFoundException('Password reset by email is not set up on this server');
    }
  }
}
