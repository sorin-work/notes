import { Inject, Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { APP_CONFIG, AppConfig, MailConfig } from '../config/config';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/** The one thing the app asks of nodemailer, so tests can put a fake in its place. */
export interface MailTransport {
  sendMail(message: OutgoingMail & { from: string }): Promise<unknown>;
}

export function createSmtpTransport(mail: MailConfig): MailTransport {
  return createTransport({
    host: mail.host,
    port: mail.port,
    // Port 465 speaks TLS from the first byte. Any other port starts in plain
    // text and switches to TLS when the server offers STARTTLS.
    secure: mail.port === 465,
    auth: mail.user ? { user: mail.user, pass: mail.password ?? '' } : undefined,
    // Mails go out in the background, so a server that does not answer
    // should not keep a socket open for nodemailer's default of two minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** Plain text mail over SMTP. Off when SMTP_HOST is not set. */
@Injectable()
export class MailService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport | null,
  ) {}

  get enabled(): boolean {
    return this.config.mail !== null && this.transport !== null;
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.config.mail || !this.transport) {
      throw new Error('Mail is not configured');
    }
    await this.transport.sendMail({ from: this.config.mail.from, ...mail });
  }
}
