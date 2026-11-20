import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../auth/password';
import type { AppConfig } from '../config/config';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { SharePasswordAttempts, TooManyWrongPasswords } from './share-password-attempts';
import { newShareToken, SharesService } from './shares.service';

const USER = 'user-1';
const createdAt = new Date('2026-02-14T10:00:00Z');

describe('SharesService', () => {
  let prisma: PrismaMock;
  let service: SharesService;
  let attempts: SharePasswordAttempts;

  beforeEach(() => {
    prisma = createPrismaMock();
    // Three wrong passwords a minute for a link.
    attempts = new SharePasswordAttempts({ authThrottleLimit: 3 } as AppConfig);
    service = new SharesService(asPrismaService(prisma), attempts);
  });

  it('returns null for a note that is not shared', async () => {
    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: null });
    prisma.shareLink.findUnique.mockResolvedValue(null);
    await expect(service.get(USER, 'n1')).resolves.toBeNull();
  });

  const link = { id: 's1', noteId: 'n1', token: 'tok', viewCount: 4, createdAt, expiresAt: null, passwordHash: null };

  it('creates a link or returns the existing one', async () => {
    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: null });
    prisma.shareLink.upsert.mockResolvedValue(link);
    await expect(service.create(USER, 'n1')).resolves.toEqual({
      token: 'tok',
      viewCount: 4,
      createdAt,
      expiresAt: null,
      expired: false,
      hasPassword: false,
    });
    expect(prisma.shareLink.upsert).toHaveBeenCalledWith({
      where: { noteId: 'n1' },
      create: { noteId: 'n1', token: expect.any(String) },
      update: {},
    });
  });

  describe('options', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    beforeEach(() => {
      prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: null });
      prisma.shareLink.findUnique.mockResolvedValue(link);
      prisma.shareLink.update.mockImplementation(({ data }) => Promise.resolve({ ...link, ...data }));
    });

    it('sets an expiry and a password, storing the password only as a hash', async () => {
      const view = await service.update(USER, 'n1', { expiresAt: tomorrow.toISOString(), password: 'open sesame' });

      const { data } = prisma.shareLink.update.mock.calls[0][0];
      expect(data.expiresAt).toEqual(tomorrow);
      expect(data.passwordHash).not.toContain('open sesame');
      expect(await verifyPassword('open sesame', data.passwordHash)).toBe(true);
      expect(view).toMatchObject({ expiresAt: tomorrow, expired: false, hasPassword: true });
      expect(view).not.toHaveProperty('passwordHash');
    });

    it('takes both away with null, and leaves alone what is not mentioned', async () => {
      await service.update(USER, 'n1', { expiresAt: null, password: null });
      expect(prisma.shareLink.update.mock.calls[0][0].data).toEqual({ expiresAt: null, passwordHash: null });

      await service.update(USER, 'n1', {});
      expect(prisma.shareLink.update.mock.calls[1][0].data).toEqual({});
    });

    it('refuses a date that cannot be read, should one get past the DTO', async () => {
      await expect(service.update(USER, 'n1', { expiresAt: '2027-W01' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.shareLink.update).not.toHaveBeenCalled();
    });

    it('refuses an expiry that has already passed', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await expect(service.update(USER, 'n1', { expiresAt: yesterday })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.shareLink.update).not.toHaveBeenCalled();
    });

    it('404s for a note that is not shared', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(null);
      await expect(service.update(USER, 'n1', { password: null })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('shows the owner that a link has run out', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({ ...link, expiresAt: new Date(Date.now() - 1000) });
      await expect(service.get(USER, 'n1')).resolves.toMatchObject({ expired: true });
    });
  });

  it('does not share notes in the trash', async () => {
    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: new Date() });
    await expect(service.create(USER, 'n1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('revokes the link', async () => {
    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: null });
    await service.revoke(USER, 'n1');
    expect(prisma.shareLink.deleteMany).toHaveBeenCalledWith({ where: { noteId: 'n1' } });
  });

  describe('view', () => {
    const shared = {
      id: 's1',
      token: 'tok',
      expiresAt: null as Date | null,
      passwordHash: null as string | null,
      note: {
        userId: 'owner-1',
        title: 'Recipe',
        content: 'Bread',
        updatedAt: createdAt,
        deletedAt: null as Date | null,
        tags: [{ tag: { name: 'baking' } }],
      },
    };
    const now = new Date('2026-03-01T12:00:00Z');

    it('returns the note and counts the view', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(shared);
      await expect(service.view('tok')).resolves.toEqual({
        title: 'Recipe',
        content: 'Bread',
        tags: ['baking'],
        updatedAt: createdAt,
      });
      expect(prisma.shareLink.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { viewCount: { increment: 1 } },
      });
    });

    it('404s for unknown tokens', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(null);
      await expect(service.view('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s once the note is in the trash', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({ ...shared, note: { ...shared.note, deletedAt: new Date() } });
      await expect(service.view('tok')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shareLink.update).not.toHaveBeenCalled();
    });

    it('does not count the owner looking at their own note', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(shared);
      await service.view('tok', { userId: 'owner-1' });
      expect(prisma.shareLink.update).not.toHaveBeenCalled();
      await service.view('tok', { userId: 'someone-else' });
      expect(prisma.shareLink.update).toHaveBeenCalledTimes(1);
    });

    it('stops working the moment it runs out', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({ ...shared, expiresAt: new Date(now.getTime() + 1000) });
      await expect(service.view('tok', {}, now)).resolves.toMatchObject({ title: 'Recipe' });

      prisma.shareLink.findUnique.mockResolvedValue({ ...shared, expiresAt: now });
      await expect(service.view('tok', {}, now)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shareLink.update).toHaveBeenCalledTimes(1);
    });

    describe('behind a password', () => {
      let protectedLink: typeof shared;

      beforeAll(async () => {
        protectedLink = { ...shared, passwordHash: await hashPassword('open sesame') };
      });

      it('asks for the password, in a way the page can tell from "gone"', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        const refused = await service.view('tok').catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(ForbiddenException);
        expect((refused as ForbiddenException).getResponse()).toMatchObject({
          statusCode: 403,
          passwordRequired: true,
        });
        expect(prisma.shareLink.update).not.toHaveBeenCalled();
      });

      it('refuses a wrong password the same way and counts no view', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        const refused = await service.view('tok', { password: 'open says me' }).catch((error: unknown) => error);
        expect((refused as ForbiddenException).getResponse()).toMatchObject({
          statusCode: 403,
          passwordRequired: true,
        });
        expect(prisma.shareLink.update).not.toHaveBeenCalled();
      });

      it('shows the note for the right password and counts the view', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        await expect(service.view('tok', { password: 'open sesame' })).resolves.toMatchObject({ title: 'Recipe' });
        expect(prisma.shareLink.update).toHaveBeenCalledTimes(1);
      });

      /** How a password was refused. Fails the test when it was taken. */
      const guess = async (viewer: { userId?: string; password: string }): Promise<HttpException> => {
        try {
          await service.view('tok', viewer);
        } catch (error) {
          return error as HttpException;
        }
        throw new Error(`"${viewer.password}" opened the note`);
      };

      it('takes three wrong passwords a minute and then refuses every password, the right one too', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        for (const password of ['guess-1', 'guess-2', 'guess-3']) {
          expect((await guess({ password })).getStatus()).toBe(403);
        }
        const fourth = await guess({ password: 'guess-4' });
        expect(fourth).toBeInstanceOf(TooManyWrongPasswords);
        expect(fourth.getStatus()).toBe(429);
        expect((fourth as TooManyWrongPasswords).retryAfterSeconds).toBeGreaterThan(0);
        expect((await guess({ password: 'open sesame' })).getStatus()).toBe(429);
        expect(prisma.shareLink.update).not.toHaveBeenCalled();
      });

      it('refuses without comparing the password once the allowance is gone', async () => {
        // A hash that makes the comparison throw, so reaching it would show.
        prisma.shareLink.findUnique.mockResolvedValue({ ...protectedLink, passwordHash: 42 });
        for (let i = 0; i < 3; i++) attempts.take('s1');
        expect((await guess({ password: 'open sesame' })).getStatus()).toBe(429);
      });

      it('does not count right passwords, so readers do not close the link to each other', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        for (let i = 0; i < 5; i++) {
          await expect(service.view('tok', { password: 'open sesame' })).resolves.toMatchObject({ title: 'Recipe' });
        }
        expect((await guess({ password: 'guess-1' })).getStatus()).toBe(403);
        expect((await guess({ password: 'guess-2' })).getStatus()).toBe(403);
        await expect(service.view('tok', { password: 'open sesame' })).resolves.toMatchObject({ title: 'Recipe' });
        expect((await guess({ password: 'guess-3' })).getStatus()).toBe(403);
        expect((await guess({ password: 'open sesame' })).getStatus()).toBe(429);
      });

      it('never holds the owner back, and does not count the owner against the link', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        // The owner mistypes more often than the link allows: still 403, and nothing is used up.
        for (let i = 0; i < 4; i++) {
          expect((await guess({ userId: 'owner-1', password: 'mistyped' })).getStatus()).toBe(403);
        }
        for (const password of ['guess-1', 'guess-2', 'guess-3']) {
          expect((await guess({ password })).getStatus()).toBe(403);
        }
        expect((await guess({ userId: 'someone-else', password: 'open sesame' })).getStatus()).toBe(429);
        // Closed to everyone else, open to the owner.
        await expect(service.view('tok', { userId: 'owner-1', password: 'open sesame' })).resolves.toMatchObject({
          title: 'Recipe',
        });
      });

      it('counts each link on its own', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        for (const password of ['guess-1', 'guess-2', 'guess-3']) await guess({ password });
        prisma.shareLink.findUnique.mockResolvedValue({ ...protectedLink, id: 's2' });
        await expect(service.view('tok-2', { password: 'open sesame' })).resolves.toMatchObject({ title: 'Recipe' });
      });

      it('looks like any dead link once it has run out, password or not', async () => {
        prisma.shareLink.findUnique.mockResolvedValue({ ...protectedLink, expiresAt: now });
        await expect(service.view('tok', {}, now)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.view('tok', { password: 'open sesame' }, now)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.view('tok', { password: 'wrong' }, now)).rejects.toBeInstanceOf(NotFoundException);
      });
    });
  });
});

describe('newShareToken', () => {
  it('makes URL-safe tokens that are hard to guess', () => {
    const tokens = new Set(Array.from({ length: 50 }, newShareToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});
