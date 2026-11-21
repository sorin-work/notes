import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import type { AppConfig } from '../config/config';
import { AuthResult, AuthService, TwoStepTicket } from './auth.service';
import { EmailChangeService } from './email-change.service';
import { hashPassword, verifyPassword } from './password';
import { DEFAULT_PREFERENCES } from './preferences';
import { codeAt, stepAt } from './totp';
import { encryptSecret } from './two-step-crypto';
import { TwoStepService } from './two-step.service';

const NOTEBOOK = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '22222222-2222-4222-8222-222222222222';

describe('AuthService', () => {
  let prisma: PrismaMock;
  let jwt: JwtService;
  let service: AuthService;

  const user = {
    id: '6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e',
    email: 'ada@example.com',
    name: 'Ada',
    passwordHash: '',
    tokenVersion: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeAll(async () => {
    user.passwordHash = await hashPassword('correct-horse');
  });

  beforeEach(() => {
    prisma = createPrismaMock();
    jwt = new JwtService({ secret: 'test-secret-that-is-long-enough-0123456789' });
    service = new AuthService(asPrismaService(prisma), jwt);
  });

  describe('register', () => {
    it('creates the user with a hashed password and returns a token', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }) => Promise.resolve({ ...user, ...data }));

      const result = await service.register({ email: user.email, name: 'Ada', password: 'correct-horse' });

      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data.passwordHash).not.toBe('correct-horse');
      expect(await verifyPassword('correct-horse', data.passwordHash)).toBe(true);
      expect(result.user).toEqual({
        id: user.id,
        email: user.email,
        name: 'Ada',
        createdAt: user.createdAt,
        preferences: DEFAULT_PREFERENCES,
        twoStep: false,
        pendingEmail: null,
      });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(jwt.verify(result.token)).toMatchObject({ sub: user.id, ver: 0 });
    });

    it('refuses an email that is already registered', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(service.register({ email: user.email, name: 'Ada', password: 'whatever1' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns a token for the right password', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      const result = (await service.login({ email: user.email, password: 'correct-horse' })) as AuthResult;
      expect(result.user.email).toBe(user.email);
      expect(jwt.verify(result.token).sub).toBe(user.id);
    });

    it('puts the current token version in the token', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 4 });
      const result = (await service.login({ email: user.email, password: 'correct-horse' })) as AuthResult;
      expect(jwt.verify(result.token).ver).toBe(4);
    });

    it('gives the same error for a wrong password and an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(null);
      const wrongPassword = service.login({ email: user.email, password: 'nope-nope' });
      await expect(wrongPassword).rejects.toThrow('Email or password is incorrect');
      const unknownEmail = service.login({ email: 'nobody@example.com', password: 'nope-nope' });
      await expect(unknownEmail).rejects.toThrow('Email or password is incorrect');
    });
  });

  describe('two-step sign-in', () => {
    const key = Buffer.alloc(32, 9);
    const secret = Buffer.from('12345678901234567890');
    const now = new Date('2026-11-21T12:00:00Z');
    let twoStep: TwoStepService;
    let withCodes: typeof user & { twoStepSecret: string; twoStepSince: Date; twoStepLastStep: number | null };

    beforeEach(() => {
      twoStep = new TwoStepService(asPrismaService(prisma), { authThrottleLimit: 10, twoStepKey: key } as AppConfig);
      jest.spyOn(twoStep, 'warnOwner').mockImplementation(() => {});
      service = new AuthService(asPrismaService(prisma), jwt, undefined, twoStep);
      withCodes = {
        ...user,
        twoStepSecret: encryptSecret(key, user.id, secret),
        twoStepSince: new Date('2026-11-01T00:00:00Z'),
        twoStepLastStep: null,
      };
    });

    it('answers a ticket instead of a token, and the ticket is no login', async () => {
      prisma.user.findUnique.mockResolvedValue(withCodes);
      const result = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      expect(result).toEqual({ twoStep: true, ticket: expect.any(String) });
      expect(result).not.toHaveProperty('token');
      prisma.user.findUnique.mockResolvedValue({ email: user.email, tokenVersion: 0 });
      await expect(service.identify(result.ticket)).resolves.toBeNull();
    });

    it('signs in with the ticket and the right code, once', async () => {
      prisma.user.findUnique.mockResolvedValue(withCodes);
      const { ticket } = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      prisma.user.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      const code = codeAt(secret, stepAt(now));

      const result = await service.loginWithCode(ticket, code, '203.0.113.7', now);
      expect(jwt.verify(result.token).sub).toBe(user.id);
      // Taken only if its step is after the last one taken, in the same statement that moves it.
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: user.id, OR: [{ twoStepLastStep: null }, { twoStepLastStep: { lt: stepAt(now) } }] },
        data: { twoStepLastStep: stepAt(now) },
      });
      // The ticket signed in once and is spent, whatever comes with it.
      await expect(service.loginWithCode(ticket, code, '203.0.113.7', now)).rejects.toThrow('this sign-in is done');
      // The same code with a new ticket finds its step taken.
      const again = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      await expect(service.loginWithCode(again.ticket, code, '203.0.113.7', now)).rejects.toThrow(
        'That code is not right',
      );
    });

    it('takes the codes of one step before and after, and no further', async () => {
      prisma.user.findUnique.mockResolvedValue(withCodes);
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      const ticket = async () =>
        ((await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket).ticket;
      for (const offset of [-1, 1]) {
        await expect(
          service.loginWithCode(await ticket(), codeAt(secret, stepAt(now) + offset), '203.0.113.7', now),
        ).resolves.toHaveProperty('token');
      }
      await expect(
        service.loginWithCode(await ticket(), codeAt(secret, stepAt(now) + 2), '203.0.113.7', now),
      ).rejects.toThrow('That code is not right');
      expect(twoStep.warnOwner).toHaveBeenCalledTimes(1);
    });

    it('uses a ticket up after five wrong codes, and does not stop another address', async () => {
      prisma.user.findUnique.mockResolvedValue(withCodes);
      const first = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(service.loginWithCode(first.ticket, '000000', '198.51.100.1', now)).rejects.toThrow(
          'That code is not right',
        );
      }
      await expect(service.loginWithCode(first.ticket, '000000', '198.51.100.1', now)).rejects.toThrow(
        'Sign in with your password again',
      );
      // The owner, somewhere else, with a ticket of their own.
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      const own = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      await expect(
        service.loginWithCode(own.ticket, codeAt(secret, stepAt(now)), '203.0.113.7', now),
      ).resolves.toHaveProperty('token');
    });

    it('counts codes per account and address across tickets', async () => {
      prisma.user.findUnique.mockResolvedValue(withCodes);
      for (let attempt = 0; attempt < 10; attempt++) {
        const { ticket } = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
        await expect(service.loginWithCode(ticket, '000000', '198.51.100.1', now)).rejects.toThrow(
          'That code is not right',
        );
      }
      const { ticket } = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      await expect(service.loginWithCode(ticket, '000000', '198.51.100.1', now)).rejects.toThrow(
        'Too many codes from here',
      );
      await expect(service.loginWithCode(ticket, '000000', '203.0.113.7', now)).rejects.toThrow(
        'That code is not right',
      );
    });

    it('refuses a ticket from before the password changed, and a login token as a ticket', async () => {
      prisma.user.findUnique.mockResolvedValue(withCodes);
      const { ticket } = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      prisma.user.findUnique.mockResolvedValue({ ...withCodes, tokenVersion: 1 });
      await expect(service.loginWithCode(ticket, codeAt(secret, stepAt(now)), '203.0.113.7', now)).rejects.toThrow(
        'Sign in with your password again',
      );
      const token = await jwt.signAsync({ sub: user.id, ver: 1 });
      await expect(service.loginWithCode(token, codeAt(secret, stepAt(now)), '203.0.113.7', now)).rejects.toThrow(
        'Sign in with your password again',
      );
    });

    it('takes a recovery code once', async () => {
      prisma.user.findUnique.mockResolvedValue(withCodes);
      const { ticket } = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      prisma.recoveryCode.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
      await expect(service.loginWithCode(ticket, 'ABCD-EFGH-JKMN-PQRS', '203.0.113.7', now)).resolves.toHaveProperty(
        'token',
      );
      expect(prisma.recoveryCode.deleteMany).toHaveBeenCalledWith({
        where: { userId: user.id, codeHash: expect.stringMatching(/^[0-9a-f]{64}$/) },
      });
      const reused = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      await expect(service.loginWithCode(reused.ticket, 'abcdefghjkmnpqrs', '203.0.113.7', now)).rejects.toThrow(
        'That code is not right',
      );
    });

    it('refuses codes from the app after 20 wrong ones in an hour from anywhere, and still takes a recovery code', async () => {
      prisma.user.findUnique.mockResolvedValue(withCodes);
      const ticket = async () =>
        ((await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket).ticket;
      for (let attempt = 0; attempt < 20; attempt++) {
        await expect(service.loginWithCode(await ticket(), '000000', `198.51.100.${attempt}`, now)).rejects.toThrow(
          'That code is not right',
        );
      }
      prisma.user.updateMany.mockResolvedValue({ count: 1 });
      await expect(
        service.loginWithCode(await ticket(), codeAt(secret, stepAt(now)), '203.0.113.7', now),
      ).rejects.toThrow('A recovery code still works');
      prisma.recoveryCode.deleteMany.mockResolvedValue({ count: 1 });
      await expect(
        service.loginWithCode(await ticket(), 'abcd-efgh-jkmn-pqrs', '203.0.113.7', now),
      ).resolves.toHaveProperty('token');
      // An hour later the app's codes work again.
      const later = new Date(now.getTime() + 61 * 60 * 1000);
      await expect(
        service.loginWithCode(await ticket(), codeAt(secret, stepAt(later)), '203.0.113.7', later),
      ).resolves.toHaveProperty('token');
    });

    it('answers 503 for a key that does not fit, as for a missing one', async () => {
      const other = new TwoStepService(asPrismaService(prisma), {
        authThrottleLimit: 10,
        twoStepKey: Buffer.alloc(32, 8),
      } as AppConfig);
      service = new AuthService(asPrismaService(prisma), jwt, undefined, other);
      prisma.user.findUnique.mockResolvedValue(withCodes);
      const { ticket } = (await service.login({ email: user.email, password: 'correct-horse' })) as TwoStepTicket;
      await expect(service.loginWithCode(ticket, codeAt(secret, stepAt(now)), '203.0.113.7', now)).rejects.toThrow(
        'cannot be checked on this server',
      );
    });
  });

  describe('me', () => {
    it('returns the user without the password hash', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      expect(await service.me(user.id)).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        preferences: DEFAULT_PREFERENCES,
        twoStep: false,
        pendingEmail: null,
      });
    });

    it('returns the preferences that are stored, and defaults for what is missing or wrong', async () => {
      const stored = { dailyNotes: { notebookId: NOTEBOOK, templateId: 'not-an-id', dateFormat: 'long' }, extra: 1 };
      prisma.user.findUnique.mockResolvedValue({ ...user, preferences: stored });
      expect((await service.me(user.id)).preferences).toEqual({
        dailyNotes: { notebookId: NOTEBOOK, templateId: null, dateFormat: 'long' },
      });
    });
  });

  describe('updatePreferences', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        preferences: { dailyNotes: { notebookId: NOTEBOOK, dateFormat: 'long' } },
      });
      // Answers with what was stored, like the database does.
      prisma.user.update.mockImplementation(({ data }) => Promise.resolve({ ...user, preferences: data.preferences }));
    });

    it('changes what is sent, keeps the rest and stores the whole', async () => {
      prisma.note.findFirst.mockResolvedValue({ id: TEMPLATE });
      const next = await service.updatePreferences(user.id, { dailyNotes: { templateId: TEMPLATE } });
      expect(next).toEqual({ dailyNotes: { notebookId: NOTEBOOK, templateId: TEMPLATE, dateFormat: 'long' } });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { preferences: next } });
      // The template has to be a template of this user, outside the trash.
      expect(prisma.note.findFirst).toHaveBeenCalledWith({
        where: { userId: user.id, deletedAt: null, isTemplate: true, id: TEMPLATE },
      });
    });

    it('clears a choice with null, without looking anything up', async () => {
      const next = await service.updatePreferences(user.id, { dailyNotes: { notebookId: null, dateFormat: 'us' } });
      expect(next.dailyNotes).toEqual({ notebookId: null, templateId: null, dateFormat: 'us' });
      expect(prisma.notebook.findFirst).not.toHaveBeenCalled();
    });

    it('refuses a notebook or a template that is not the user’s own', async () => {
      prisma.notebook.findFirst.mockResolvedValue(null);
      prisma.note.findFirst.mockResolvedValue(null);
      await expect(service.updatePreferences(user.id, { dailyNotes: { notebookId: TEMPLATE } })).rejects.toThrow(
        'There is no such notebook',
      );
      await expect(service.updatePreferences(user.id, { dailyNotes: { templateId: NOTEBOOK } })).rejects.toThrow(
        'There is no such template',
      );
      expect(prisma.notebook.findFirst).toHaveBeenCalledWith({ where: { id: TEMPLATE, userId: user.id } });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('404s for a user that was deleted after the token was issued', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.me(user.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('changes the name without asking for the password', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ ...user, name: 'Ada L.' });
      const result = await service.updateProfile(user.id, { name: 'Ada L.', email: user.email });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { name: 'Ada L.' } });
      expect(result.name).toBe('Ada L.');
    });

    it('needs the current password to change the email', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(service.updateProfile(user.id, { email: 'new@example.com' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.updateProfile(user.id, { email: 'new@example.com', currentPassword: 'wrong-one' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('changes the email when the password matches', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({ ...user, email: 'new@example.com' });
      const result = await service.updateProfile(user.id, {
        email: 'new@example.com',
        currentPassword: 'correct-horse',
      });
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { email: 'new@example.com' } });
      expect(result.email).toBe('new@example.com');
      // A reset link mailed to the old address must not work any more.
      expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({ where: { userId: user.id } });
    });

    it('keeps a new email waiting for its link when mail is set up, and changes the name at once', async () => {
      const emailChanges = {
        confirms: true,
        request: jest.fn(),
        pending: jest.fn().mockResolvedValue('new@example.com'),
      };
      service = new AuthService(
        asPrismaService(prisma),
        jwt,
        undefined,
        undefined,
        emailChanges as unknown as EmailChangeService,
      );
      prisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce(null);
      prisma.user.update.mockResolvedValue({ ...user, name: 'Ada L.' });
      const result = await service.updateProfile(user.id, {
        name: 'Ada L.',
        email: 'new@example.com',
        currentPassword: 'correct-horse',
      });
      expect(emailChanges.request).toHaveBeenCalledWith(user, 'new@example.com');
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { name: 'Ada L.' } });
      expect(result).toMatchObject({ email: user.email, name: 'Ada L.', pendingEmail: 'new@example.com' });
    });

    it('refuses an email that belongs to another account', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(user).mockResolvedValueOnce({ ...user, id: 'someone-else' });
      await expect(
        service.updateProfile(user.id, { email: 'taken@example.com', currentPassword: 'correct-horse' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('writes nothing when nothing changed', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await service.updateProfile(user.id, { name: user.name, email: user.email });
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    it('stores a new hash, bumps the token version and returns a token for it', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue({ ...user, tokenVersion: 1 });
      const result = await service.changePassword(user.id, {
        currentPassword: 'correct-horse',
        newPassword: 'battery-staple',
      });
      const { passwordHash, tokenVersion } = prisma.user.update.mock.calls[0][0].data;
      expect(await verifyPassword('battery-staple', passwordHash)).toBe(true);
      expect(tokenVersion).toEqual({ increment: 1 });
      expect(jwt.verify(result.token)).toMatchObject({ sub: user.id, ver: 1 });
      expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({ where: { userId: user.id } });
    });

    it('refuses when the current password is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(
        service.changePassword(user.id, { currentPassword: 'wrong-one', newPassword: 'battery-staple' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('assertPassword', () => {
    it('passes for the right password and answers 403 for a wrong one', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(service.assertPassword(user.id, 'correct-horse')).resolves.toBeUndefined();
      await expect(service.assertPassword(user.id, 'wrong-one')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('logoutEverywhere', () => {
    it('bumps the token version', async () => {
      prisma.user.update.mockResolvedValue({ ...user, tokenVersion: 1 });
      await service.logoutEverywhere(user.id);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: { tokenVersion: { increment: 1 } },
      });
    });
  });

  describe('deleteAccount', () => {
    it('deletes the user when the password matches', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await service.deleteAccount(user.id, { password: 'correct-horse' });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: user.id } });
    });

    it('refuses when the password is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(service.deleteAccount(user.id, { password: 'wrong-one' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });
  });
});
