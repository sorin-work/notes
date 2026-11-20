import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import type { MailService, OutgoingMail } from '../mail/mail.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { verifyPassword } from './password';
import { hashResetToken, PasswordResetService, RESET_LINK_TTL_MS, resetMail } from './password-reset.service';

describe('PasswordResetService', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const user = { id: 'user-1', email: 'ada@example.com', name: 'Ada' };
  const config = { appUrl: 'https://notes.example.com' } as AppConfig;

  let prisma: PrismaMock;
  let sent: OutgoingMail[];
  let mail: { enabled: boolean; send: jest.Mock };
  let service: PasswordResetService;

  /** The token in the link of the mail that was sent last. */
  const mailedToken = () => /token=([\w-]+)/.exec(sent[sent.length - 1].text)?.[1] ?? '';

  beforeEach(() => {
    prisma = createPrismaMock();
    sent = [];
    mail = { enabled: true, send: jest.fn((message: OutgoingMail) => Promise.resolve(void sent.push(message))) };
    service = new PasswordResetService(asPrismaService(prisma), mail as unknown as MailService, config);
  });

  describe('sendLink', () => {
    it('mails a link and stores only the hash of its token', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.findFirst.mockResolvedValue(null);

      await expect(service.sendLink(user.email, now)).resolves.toBe(true);

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(user.email);
      expect(sent[0].text).toContain('https://notes.example.com/reset-password?token=');
      const token = mailedToken();
      expect(token.length).toBeGreaterThanOrEqual(43);
      const { data } = prisma.passwordReset.create.mock.calls[0][0];
      expect(data).toEqual({
        userId: user.id,
        tokenHash: hashResetToken(token),
        createdAt: now,
        expiresAt: new Date(now.getTime() + RESET_LINK_TTL_MS),
      });
      expect(JSON.stringify(data)).not.toContain(token);
    });

    it('drops the earlier links of the account, so only the newest works', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.findFirst.mockResolvedValue({ createdAt: new Date(now.getTime() - 10 * 60 * 1000) });
      await service.sendLink(user.email, now);
      expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ userId: user.id }, { expiresAt: { lt: now } }] },
      });
    });

    it('does nothing for an address without an account', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.sendLink('nobody@example.com', now)).resolves.toBe(false);
      expect(prisma.passwordReset.create).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });

    it('sends one mail a minute per account at most', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.findFirst.mockResolvedValue({ createdAt: new Date(now.getTime() - 30 * 1000) });
      await expect(service.sendLink(user.email, now)).resolves.toBe(false);
      expect(prisma.passwordReset.create).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });

    it('takes the link back when the mail could not be sent', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.findFirst.mockResolvedValue(null);
      mail.send.mockRejectedValue(new Error('connection refused'));

      await expect(service.sendLink(user.email, now)).rejects.toThrow('connection refused');

      const { tokenHash } = prisma.passwordReset.create.mock.calls[0][0].data;
      expect(prisma.passwordReset.deleteMany).toHaveBeenLastCalledWith({ where: { tokenHash } });
    });
  });

  describe('request', () => {
    it('returns at once and keeps a failure to itself', async () => {
      prisma.user.findUnique.mockRejectedValue(new Error('database is down'));
      expect(service.request(user.email)).toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));
    });

    it('answers 404 when mail is not set up', () => {
      mail.enabled = false;
      expect(() => service.request(user.email)).toThrow(NotFoundException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    const link = { id: 'link-1', userId: user.id, expiresAt: new Date(now.getTime() + 60 * 1000) };

    it('sets the password, bumps the token version and uses the link up', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue(link);
      prisma.passwordReset.deleteMany.mockResolvedValue({ count: 1 });

      await service.reset('the-token', 'battery-staple', now);

      expect(prisma.passwordReset.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashResetToken('the-token') },
      });
      expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({ where: { id: link.id } });
      const update = prisma.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: user.id });
      expect(update.data.tokenVersion).toEqual({ increment: 1 });
      expect(await verifyPassword('battery-staple', update.data.passwordHash)).toBe(true);
    });

    it('refuses an unknown token, an expired one and one that was just used', async () => {
      prisma.passwordReset.findUnique.mockResolvedValueOnce(null);
      await expect(service.reset('nope', 'battery-staple', now)).rejects.toBeInstanceOf(BadRequestException);

      prisma.passwordReset.findUnique.mockResolvedValueOnce({ ...link, expiresAt: now });
      await expect(service.reset('late', 'battery-staple', now)).rejects.toBeInstanceOf(BadRequestException);

      // Two requests with the same token: the other one deleted the row first.
      prisma.passwordReset.findUnique.mockResolvedValueOnce(link);
      prisma.passwordReset.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.reset('twice', 'battery-staple', now)).rejects.toBeInstanceOf(BadRequestException);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('answers 404 when mail is not set up', async () => {
      mail.enabled = false;
      await expect(service.reset('the-token', 'battery-staple', now)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('resetMail', () => {
  it('is plain text with the link on a line of its own', () => {
    const message = resetMail('ada@example.com', 'Ada', 'https://notes.example.com/reset-password?token=abc');
    expect(message.to).toBe('ada@example.com');
    expect(message.subject).toBe('Reset your Notes password');
    expect(message.text.split('\n')).toContain('https://notes.example.com/reset-password?token=abc');
    expect(message.text).toContain('Hello Ada,');
  });
});
