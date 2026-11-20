import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { AuthService } from './auth.service';
import { hashPassword, verifyPassword } from './password';
import { DEFAULT_PREFERENCES } from './preferences';

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
      const result = await service.login({ email: user.email, password: 'correct-horse' });
      expect(result.user.email).toBe(user.email);
      expect(jwt.verify(result.token).sub).toBe(user.id);
    });

    it('puts the current token version in the token', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 4 });
      const result = await service.login({ email: user.email, password: 'correct-horse' });
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

  describe('me', () => {
    it('returns the user without the password hash', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      expect(await service.me(user.id)).toEqual({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        preferences: DEFAULT_PREFERENCES,
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
