import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { AuthService } from './auth.service';
import { hashPassword, verifyPassword } from './password';

describe('AuthService', () => {
  let prisma: PrismaMock;
  let jwt: JwtService;
  let service: AuthService;

  const user = {
    id: '6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e',
    email: 'ada@example.com',
    name: 'Ada',
    passwordHash: '',
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
      expect(result.user).toEqual({ id: user.id, email: user.email, name: 'Ada', createdAt: user.createdAt });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(jwt.verify(result.token)).toMatchObject({ sub: user.id, email: user.email });
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
      });
    });

    it('404s for a user that was deleted after the token was issued', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.me(user.id)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('changePassword', () => {
    it('stores a new hash when the current password matches', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);
      await service.changePassword(user.id, { currentPassword: 'correct-horse', newPassword: 'battery-staple' });
      const { passwordHash } = prisma.user.update.mock.calls[0][0].data;
      expect(await verifyPassword('battery-staple', passwordHash)).toBe(true);
    });

    it('refuses when the current password is wrong', async () => {
      prisma.user.findUnique.mockResolvedValue(user);
      await expect(
        service.changePassword(user.id, { currentPassword: 'wrong-one', newPassword: 'battery-staple' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
