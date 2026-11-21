import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/config';
import { MailService, OutgoingMail } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { failureKind, hashResetToken, RESET_LINK_TTL_MS } from './password-reset.service';

const LINK_NOT_VALID = 'This link does not work any more. Change the email in Settings again.';

/**
 * To the new address. Like the reset mail, nothing in it comes from the
 * account: whoever asks chooses the address it goes to.
 */
export function confirmEmailMail(to: string, link: string): OutgoingMail {
  return {
    to,
    subject: 'Confirm your new Notes email address',
    text: [
      'Hello,',
      '',
      'Someone asked to use this address for their Notes account. To confirm it, open this link and press "Confirm the address":',
      '',
      link,
      '',
      'The link works once, for an hour. Until it is opened the account keeps its old address. If it was not you, ignore this mail.',
      '',
    ].join('\n'),
  };
}

/** To the old address, which is still the account's. */
export function emailChangeNotice(to: string, newEmail: string): OutgoingMail {
  return {
    to,
    subject: 'Your Notes email address is about to change',
    text: [
      'Hello,',
      '',
      `Someone signed in to your Notes account asked to change its email address to ${newEmail}. A link to confirm it went to that address.`,
      '',
      'If it was you, there is nothing to do here. If it was not, change your password in Settings, which also cancels the change, or ask for a password reset from the sign-in page.',
      '',
    ].join('\n'),
  };
}

/**
 * A new email address waits until the link mailed to it is opened, under
 * the rules of a reset link: only a hash of the token, once, for an hour.
 * An account has one such address at a time, and asking again replaces it.
 * The old address hears about it when it is asked for.
 *
 * Without mail there is nothing to confirm with, and the address changes at
 * once, as it did before.
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get confirms(): boolean {
    return this.mail.enabled;
  }

  /** The address waiting to be confirmed, if any. */
  async pending(userId: string, now = new Date()): Promise<string | null> {
    const change = await this.prisma.emailChange.findFirst({
      where: { userId, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    return change?.newEmail ?? null;
  }

  /**
   * Mails the link, and answers only once the mail is out: unlike a reset,
   * the person asking is signed in and should hear when it did not work.
   */
  async request(user: { id: string; email: string }, newEmail: string, now = new Date()): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashResetToken(token);
    await this.prisma.$transaction([
      this.prisma.emailChange.deleteMany({ where: { userId: user.id } }),
      this.prisma.emailChange.create({
        data: {
          userId: user.id,
          newEmail,
          tokenHash,
          createdAt: now,
          expiresAt: new Date(now.getTime() + RESET_LINK_TTL_MS),
        },
      }),
    ]);
    try {
      await this.mail.send(confirmEmailMail(newEmail, `${this.config.appUrl}/confirm-email#token=${token}`));
    } catch (error) {
      await this.prisma.emailChange.deleteMany({ where: { tokenHash } });
      this.logger.error(`Could not send the mail to confirm a new address (${failureKind(error)})`);
      throw new ServiceUnavailableException(
        'The mail to the new address could not be sent. The email was not changed. Try again later.',
      );
    }
    // The change is waiting either way, so a notice that does not go out is only logged.
    this.mail.send(emailChangeNotice(user.email, newEmail)).catch((error: unknown) => {
      this.logger.error(`Could not send the notice of a new address to the old one (${failureKind(error)})`);
    });
  }

  /**
   * Opens the link: the account takes the new address, if no other account
   * took it meanwhile. The token works once. Reset links that are still out
   * went to the old address and stop working.
   */
  async confirm(token: string, now = new Date()): Promise<void> {
    const change = await this.prisma.emailChange.findUnique({ where: { tokenHash: hashResetToken(token) } });
    if (!change || change.expiresAt.getTime() <= now.getTime()) {
      throw new BadRequestException(LINK_NOT_VALID);
    }
    await this.prisma.$transaction(async (tx) => {
      // Single use: of two requests with the same token only one finds the row.
      const used = await tx.emailChange.deleteMany({ where: { id: change.id } });
      if (used.count !== 1) {
        throw new BadRequestException(LINK_NOT_VALID);
      }
      if (await tx.user.findUnique({ where: { email: change.newEmail } })) {
        throw new ConflictException('An account with this email already exists');
      }
      await tx.user.update({ where: { id: change.userId }, data: { email: change.newEmail } });
      await tx.passwordReset.deleteMany({ where: { userId: change.userId } });
      await tx.emailChange.deleteMany({ where: { userId: change.userId } });
    });
  }

  /** For a new password and for signing out everywhere: a change asked for in a session that may not be the owner's goes. */
  async cancel(userId: string): Promise<void> {
    await this.prisma.emailChange.deleteMany({ where: { userId } });
  }
}
