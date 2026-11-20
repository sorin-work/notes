import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { AppConfig } from '../config/config';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { ApiTokensService, hashApiToken, isApiToken, MAX_API_TOKENS } from './api-tokens.service';

describe('ApiTokensService', () => {
  const now = new Date('2026-05-01T12:00:00Z');
  const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000);
  const config = { apiTokenThrottleLimit: 30 } as AppConfig;

  let prisma: PrismaMock;
  let throttler: { increment: jest.Mock };
  let service: ApiTokensService;

  beforeEach(() => {
    prisma = createPrismaMock();
    throttler = { increment: jest.fn() };
    service = new ApiTokensService(asPrismaService(prisma), config, throttler as ThrottlerStorage);
  });

  describe('create', () => {
    it('hands out a random nt_ token once and stores only its hash', async () => {
      prisma.apiToken.count.mockResolvedValue(0);
      prisma.apiToken.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 't1', name: data.name, readOnly: data.readOnly, lastUsedAt: null, createdAt: now }),
      );

      const first = await service.create('user-1', { name: 'backup script', readOnly: true });
      const second = await service.create('user-1', { name: 'other' });

      expect(first.token).toMatch(/^nt_[\w-]{43}$/);
      expect(isApiToken(first.token)).toBe(true);
      expect(second.token).not.toBe(first.token);
      const { data } = prisma.apiToken.create.mock.calls[0][0];
      expect(data).toEqual({
        userId: 'user-1',
        name: 'backup script',
        readOnly: true,
        tokenHash: hashApiToken(first.token),
      });
      expect(JSON.stringify(data)).not.toContain(first.token);
      expect(prisma.apiToken.create.mock.calls[1][0].data.readOnly).toBe(false);
    });

    it('stops at the limit per account', async () => {
      prisma.apiToken.count.mockResolvedValue(MAX_API_TOKENS);
      await expect(service.create('user-1', { name: 'one too many' })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.apiToken.create).not.toHaveBeenCalled();
    });
  });

  it('lists the tokens of one user, newest first, without the hash', async () => {
    prisma.apiToken.findMany.mockResolvedValue([]);
    await service.list('user-1');
    const query = prisma.apiToken.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ userId: 'user-1' });
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
    expect(query.select).not.toHaveProperty('tokenHash');
  });

  describe('revoke', () => {
    it('deletes the token only if it belongs to the user', async () => {
      prisma.apiToken.deleteMany.mockResolvedValue({ count: 1 });
      await service.revoke('user-1', 't1');
      expect(prisma.apiToken.deleteMany).toHaveBeenCalledWith({ where: { id: 't1', userId: 'user-1' } });
    });

    it('404s for a token of someone else', async () => {
      prisma.apiToken.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.revoke('user-2', 't1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('identify', () => {
    const row = { id: 't1', userId: 'user-1', readOnly: true, lastUsedAt: null, user: { email: 'ada@example.com' } };

    it('finds the owner by the hash of the token', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(row);
      await expect(service.identify('nt_secret', now)).resolves.toEqual({
        tokenId: 't1',
        userId: 'user-1',
        email: 'ada@example.com',
        readOnly: true,
      });
      expect(prisma.apiToken.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashApiToken('nt_secret') });
    });

    it('answers null for a token that does not exist', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(null);
      await expect(service.identify('nt_gone', now)).resolves.toBeNull();
      expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();
    });

    it('notes the use at most once a minute', async () => {
      prisma.apiToken.findUnique.mockResolvedValue({ ...row, lastUsedAt: secondsAgo(20) });
      await service.identify('nt_secret', now);
      expect(prisma.apiToken.updateMany).not.toHaveBeenCalled();

      prisma.apiToken.findUnique.mockResolvedValue({ ...row, lastUsedAt: secondsAgo(61) });
      await service.identify('nt_secret', now);
      prisma.apiToken.findUnique.mockResolvedValue(row);
      await service.identify('nt_secret', now);

      expect(prisma.apiToken.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.apiToken.updateMany).toHaveBeenLastCalledWith({
        where: { id: 't1', OR: [{ lastUsedAt: null }, { lastUsedAt: { lte: secondsAgo(60) } }] },
        data: { lastUsedAt: now },
      });
    });

    it('still lets the request through when the use could not be noted', async () => {
      prisma.apiToken.findUnique.mockResolvedValue(row);
      prisma.apiToken.updateMany.mockRejectedValue(new Error('database is busy'));
      await expect(service.identify('nt_secret', now)).resolves.toMatchObject({ tokenId: 't1' });
    });
  });

  describe('throttle', () => {
    it('counts per token against the configured limit', async () => {
      throttler.increment.mockResolvedValue({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 });
      await expect(service.throttle('t1')).resolves.toBe(0);
      expect(throttler.increment).toHaveBeenCalledWith('api-token:t1', 60_000, 30, 60_000, 'api-token');
    });

    it('says how long to wait once the token is over the limit', async () => {
      throttler.increment.mockResolvedValue({
        totalHits: 31,
        timeToExpire: 12,
        isBlocked: true,
        timeToBlockExpire: 12,
      });
      await expect(service.throttle('t1')).resolves.toBe(12);
    });

    it('lets the configured number through with the real store, then holds that token only', async () => {
      const store = new ThrottlerStorageService();
      const limited = new ApiTokensService(asPrismaService(prisma), { apiTokenThrottleLimit: 2 } as AppConfig, store);
      try {
        expect(await limited.throttle('t1')).toBe(0);
        expect(await limited.throttle('t1')).toBe(0);
        const wait = await limited.throttle('t1');
        expect(wait).toBeGreaterThan(0);
        expect(wait).toBeLessThanOrEqual(60);
        expect(await limited.throttle('t2')).toBe(0);
      } finally {
        store.onApplicationShutdown();
      }
    });
  });
});
