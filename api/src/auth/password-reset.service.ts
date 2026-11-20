import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/config';
import { MailService, OutgoingMail } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from './password';

/** How long the link in the mail works. */
export const RESET_LINK_TTL_MS = 60 * 60 * 1000;
/** One mail per account in this time, so the form cannot be used to flood a mailbox. */
export const RESET_MAIL_PAUSE_MS = 60 * 1000;

const LINK_NOT_VALID = 'This link does not work any more. Ask for a new one.';

/**
 * Only this hash is stored. The token has 256 random bits, so a fast hash is
 * enough: there is nothing to guess, unlike with a password.
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function resetMail(to: string, name: string, link: string): OutgoingMail {
  return {
    to,
    subject: 'Reset your Notes password',
    text: [
      `Hello ${name},`,
      '',
      'Someone asked to reset the password of your Notes account. To choose a new password, open this link:',
      '',
      link,
      '',
      'The link works once, for an hour. If it was not you, ignore this mail. Your password stays as it is.',
      '',
    ].join('\n'),
  };
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
      this.logger.error(`Could not send a password reset mail: ${error instanceof Error ? error.message : error}`);
    });
  }

  /** Resolves to true when a mail went out. */
  async sendLink(email: string, now = new Date()): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return false;
    }
    const latest = await this.prisma.passwordReset.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && now.getTime() - latest.createdAt.getTime() < RESET_MAIL_PAUSE_MS) {
      return false;
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(token);
    await this.prisma.$transaction([
      // Only the newest link of an account works. Links that ran out go too, whoever they belong to.
      this.prisma.passwordReset.deleteMany({ where: { OR: [{ userId: user.id }, { expiresAt: { lt: now } }] } }),
      this.prisma.passwordReset.create({
        data: { userId: user.id, tokenHash, createdAt: now, expiresAt: new Date(now.getTime() + RESET_LINK_TTL_MS) },
      }),
    ]);

    try {
      await this.mail.send(resetMail(user.email, user.name, `${this.config.appUrl}/reset-password?token=${token}`));
    } catch (error) {
      // Nobody has the token, so the row would only make the next try wait.
      await this.prisma.passwordReset.deleteMany({ where: { tokenHash } });
      throw error;
    }
    return true;
  }

  /** Sets the new password and signs the account out everywhere. */
  async reset(token: string, password: string, now = new Date()): Promise<void> {
    this.assertEnabled();
    const link = await this.prisma.passwordReset.findUnique({ where: { tokenHash: hashResetToken(token) } });
    if (!link || link.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(LINK_NOT_VALID);
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      // Single use: of two requests with the same token only one finds the row.
      const used = await tx.passwordReset.deleteMany({ where: { id: link.id } });
      if (used.count !== 1) {
        throw new BadRequestException(LINK_NOT_VALID);
      }
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
