import { createTransport } from 'nodemailer';
import type { AppConfig } from '../config/config';
import { createSmtpTransport, MailService, MailTransport } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn(() => ({ sendMail: jest.fn() })) }));

const mail = { host: 'smtp.example.com', port: 587, from: 'Notes <notes@example.com>', requireTls: true };

describe('createSmtpTransport', () => {
  const options = () => (createTransport as jest.Mock).mock.lastCall?.[0] as Record<string, unknown>;

  it('insists on STARTTLS on the submission port', () => {
    createSmtpTransport({ ...mail, user: 'mailer', password: 'secret' });
    expect(options()).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'mailer', pass: 'secret' },
    });
  });

  it('speaks TLS from the start on port 465', () => {
    createSmtpTransport({ ...mail, port: 465 });
    expect(options()).toMatchObject({ secure: true });
  });

  it('sends in the clear only when the settings say so, and logs in only with a user', () => {
    createSmtpTransport({ ...mail, host: 'mailpit', port: 1025, requireTls: false });
    expect(options()).toMatchObject({ secure: false, requireTLS: false, auth: undefined });
  });
});

describe('MailService', () => {
  it('sends from the configured address', async () => {
    const transport: MailTransport = { sendMail: jest.fn().mockResolvedValue(undefined) };
    const service = new MailService({ mail } as AppConfig, transport);

    expect(service.enabled).toBe(true);
    await service.send({ to: 'ada@example.com', subject: 'Hello', text: 'Hi Ada' });

    expect(transport.sendMail).toHaveBeenCalledWith({
      from: 'Notes <notes@example.com>',
      to: 'ada@example.com',
      subject: 'Hello',
      text: 'Hi Ada',
    });
  });

  it('is off without SMTP settings and refuses to send', async () => {
    const service = new MailService({ mail: null } as AppConfig, null);
    expect(service.enabled).toBe(false);
    await expect(service.send({ to: 'ada@example.com', subject: 'Hello', text: 'Hi' })).rejects.toThrow(
      'Mail is not configured',
    );
  });
});
