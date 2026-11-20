import type { AppConfig } from '../config/config';
import { MailService, MailTransport } from './mail.service';

const mail = { host: 'smtp.example.com', port: 587, from: 'Notes <notes@example.com>' };

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
