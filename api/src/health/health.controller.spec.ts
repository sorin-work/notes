import { ServiceUnavailableException } from '@nestjs/common';
import { asPrismaService, createPrismaMock } from '../testing/prisma-mock';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok when the database answers', async () => {
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    await expect(new HealthController(asPrismaService(prisma)).check()).resolves.toEqual({
      status: 'ok',
      database: 'ok',
    });
  });

  it('returns 503 when the database is down', async () => {
    const prisma = createPrismaMock();
    prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
    await expect(new HealthController(asPrismaService(prisma)).check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
