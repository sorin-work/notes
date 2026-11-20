import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AttachmentsService } from '../attachments/attachments.service';
import { loadConfig } from '../config/config';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { TrashService } from './trash.service';

const USER = 'user-1';
const config = loadConfig({
  DATABASE_URL: 'postgresql://x',
  JWT_SECRET: 'x'.repeat(32),
  TRASH_RETENTION_DAYS: '30',
});

describe('TrashService', () => {
  let prisma: PrismaMock;
  let service: TrashService;
  let attachments: { idsOfNotes: jest.Mock; removeFiles: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    attachments = { idsOfNotes: jest.fn().mockResolvedValue(['a1']), removeFiles: jest.fn() };
    service = new TrashService(asPrismaService(prisma), config, attachments as unknown as AttachmentsService);
  });

  it('lists trashed notes with the date they will be purged', async () => {
    const deletedAt = new Date('2026-03-01T08:00:00Z');
    prisma.note.findMany.mockResolvedValue([
      { id: 'n1', title: 'Old', content: '# Old\n\nGone soon', notebook: null, deletedAt },
    ]);
    const [item] = await service.list(USER);
    expect(item).toEqual({
      id: 'n1',
      title: 'Old',
      excerpt: 'Gone soon',
      notebook: null,
      deletedAt,
      purgeAt: new Date('2026-03-31T08:00:00Z'),
    });
    expect(prisma.note.findMany.mock.calls[0][0].where).toEqual({ userId: USER, deletedAt: { not: null } });
  });

  it('restores a trashed note', async () => {
    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: new Date() });
    await service.restore(USER, 'n1');
    expect(prisma.note.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { deletedAt: null } });
  });

  it('only deletes notes for good once they are in the trash', async () => {
    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: null });
    await expect(service.deletePermanently(USER, 'n1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.note.deleteMany).not.toHaveBeenCalled();

    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: new Date() });
    prisma.note.deleteMany.mockResolvedValue({ count: 1 });
    await service.deletePermanently(USER, 'n1');
    expect(prisma.note.deleteMany).toHaveBeenCalledWith({ where: { id: 'n1' } });
    expect(attachments.removeFiles).toHaveBeenCalledWith(['a1']);
  });

  it('404s for notes of other users', async () => {
    prisma.note.findFirst.mockResolvedValue(null);
    await expect(service.restore(USER, 'n1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('empties the user’s trash', async () => {
    prisma.note.deleteMany.mockResolvedValue({ count: 3 });
    await expect(service.empty(USER)).resolves.toEqual({ deleted: 3 });
    expect(prisma.note.deleteMany).toHaveBeenCalledWith({ where: { userId: USER, deletedAt: { not: null } } });
    // The files of their attachments go in the same step.
    expect(attachments.idsOfNotes).toHaveBeenCalledWith({ userId: USER, deletedAt: { not: null } });
    expect(attachments.removeFiles).toHaveBeenCalledWith(['a1']);
  });

  it('purges notes trashed before the retention period', async () => {
    prisma.note.deleteMany.mockResolvedValue({ count: 2 });
    const now = new Date('2026-04-30T00:00:00Z');
    await expect(service.purgeExpired(now)).resolves.toBe(2);
    expect(prisma.note.deleteMany).toHaveBeenCalledWith({
      where: { deletedAt: { lt: new Date('2026-03-31T00:00:00Z') } },
    });
    expect(attachments.removeFiles).toHaveBeenCalledWith(['a1']);
  });
});
