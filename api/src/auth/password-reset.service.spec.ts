import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import type { AppConfig } from '../config/config';
import type { MailService, OutgoingMail } from '../mail/mail.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { verifyPassword } from './password';
import {
  failureKind,
  hashResetToken,
  MAX_OPEN_RESET_LINKS,
  PasswordResetService,
  RESET_LINK_TTL_MS,
  resetMail,
} from './password-reset.service';

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
      prisma.passwordReset.count.mockResolvedValue(0);

      await expect(service.sendLink(user.email, now)).resolves.toBe(true);

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(user.email);
      // In the fragment, which browsers do not send to the server.
      expect(sent[0].text).toContain('https://notes.example.com/reset-password#token=');
      expect(sent[0].text).not.toContain('?token=');
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

    it('locks the account before it counts, so requests at the same moment cannot all get through', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.count.mockResolvedValue(0);
      await service.sendLink(user.email, now);

      const [strings, id] = prisma.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
      expect(strings.join('?')).toMatch(/SELECT id FROM users WHERE id = \?::uuid FOR UPDATE/);
      expect(id).toBe(user.id);
      const order = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];
      expect(order(prisma.$queryRaw)).toBeLessThan(order(prisma.passwordReset.count));
      expect(order(prisma.passwordReset.count)).toBeLessThan(order(prisma.passwordReset.create));
    });

    it('never cancels a link that is already out, and only clears the ones that ran out', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.count.mockResolvedValue(MAX_OPEN_RESET_LINKS - 1);

      await expect(service.sendLink(user.email, now)).resolves.toBe(true);

      expect(prisma.passwordReset.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({ where: { expiresAt: { lte: now } } });
    });

    it('sends nothing while the account has three links out', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.count.mockResolvedValue(MAX_OPEN_RESET_LINKS);

      await expect(service.sendLink(user.email, now)).resolves.toBe(false);

      expect(prisma.passwordReset.count).toHaveBeenCalledWith({ where: { userId: user.id } });
      expect(prisma.passwordReset.create).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });

    it('does nothing for an address without an account', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.sendLink('nobody@example.com', now)).resolves.toBe(false);
      expect(prisma.passwordReset.create).not.toHaveBeenCalled();
      expect(sent).toHaveLength(0);
    });

    it('takes the link back when the mail could not be sent', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.count.mockResolvedValue(0);
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

    it('keeps the text of an SMTP refusal, which quotes the address, out of the ordinary log', async () => {
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.passwordReset.count.mockResolvedValue(0);
      mail.send.mockRejectedValue(
        Object.assign(new Error('550 5.1.1 <ada@example.com>: Recipient address rejected'), {
          code: 'EENVELOPE',
          responseCode: 550,
        }),
      );

      service.request(user.email);
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));

      expect(error).toHaveBeenCalledWith('Could not send a password reset mail (EENVELOPE 550)');
      expect(error.mock.calls.flat().join(' ')).not.toContain('ada@example.com');
      expect(debug.mock.calls.flat().join(' ')).toContain('Recipient address rejected');
      error.mockRestore();
      debug.mockRestore();
    });

    it('answers 404 when mail is not set up', () => {
      mail.enabled = false;
      expect(() => service.request(user.email)).toThrow(NotFoundException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    const link = { id: 'link-1', userId: user.id, expiresAt: new Date(now.getTime() + 60 * 1000) };

    it('sets the password, bumps the token version and ends every link of the account', async () => {
      prisma.passwordReset.findUnique.mockResolvedValue(link);
      prisma.passwordReset.deleteMany.mockResolvedValue({ count: 1 });

      await service.reset('the-token', 'battery-staple', now);

      expect(prisma.passwordReset.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: hashResetToken('the-token') },
      });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prisma.passwordReset.deleteMany).toHaveBeenNthCalledWith(1, { where: { id: link.id } });
      // A second link that is still out must not set a password after this one did.
      expect(prisma.passwordReset.deleteMany).toHaveBeenNthCalledWith(2, { where: { userId: user.id } });
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
    const message = resetMail('ada@example.com', 'https://notes.example.com/reset-password#token=abc');
    expect(message.to).toBe('ada@example.com');
    expect(message.subject).toBe('Reset your Notes password');
    expect(message.text.split('\n')).toContain('https://notes.example.com/reset-password#token=abc');
  });

  it('holds nothing but fixed text and the link, whatever the account says', () => {
    const link = 'https://notes.example.com/reset-password#token=abc';
    const text = resetMail('ada@example.com', link).text;
    expect(text.replace(link, '')).toBe(resetMail('someone-else@example.com', '').text);
    expect(text).toMatch(/^Hello,\n/);
  });
});

describe('failureKind', () => {
  it('names the failure without quoting it', () => {
    expect(failureKind(Object.assign(new Error('<a@b.c> rejected'), { code: 'EENVELOPE', responseCode: 550 }))).toBe(
      'EENVELOPE 550',
    );
    expect(failureKind(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ESOCKET' }))).toBe('ESOCKET');
    expect(failureKind(new TypeError('private text'))).toBe('TypeError');
    expect(failureKind('private text')).toBe('unknown');
  });
});
