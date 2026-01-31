import { ConflictException, NotFoundException } from '@nestjs/common';
import { LinksService } from '../links/links.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { VERSION_INTERVAL_MS, VersionsService } from './versions.service';

const USER = 'user-1';
const now = new Date('2026-02-01T12:00:00Z');

const note = {
  id: 'n1',
  userId: USER,
  notebookId: null,
  title: 'Plan',
  content: 'Current text',
  pinned: false,
  favorite: false,
  deletedAt: null as Date | null,
  createdAt: now,
  updatedAt: now,
};

describe('VersionsService', () => {
  let prisma: PrismaMock;
  let links: { sync: jest.Mock };
  let service: VersionsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    links = { sync: jest.fn() };
    service = new VersionsService(asPrismaService(prisma), links as unknown as LinksService);
    prisma.noteVersion.findMany.mockResolvedValue([]);
  });

  describe('snapshotIfDue', () => {
    const tx = () => asPrismaService(prisma);

    it('saves the first version of a note', async () => {
      prisma.noteVersion.findFirst.mockResolvedValue(null);
      await expect(service.snapshotIfDue(tx(), note, now)).resolves.toBe(true);
      expect(prisma.noteVersion.create).toHaveBeenCalledWith({
        data: { noteId: 'n1', title: 'Plan', content: 'Current text', createdAt: now },
      });
    });

    it('waits for the interval between versions', async () => {
      const recent = new Date(now.getTime() - VERSION_INTERVAL_MS + 1000);
      prisma.noteVersion.findFirst.mockResolvedValue({ title: 'Plan', content: 'Older text', createdAt: recent });
      await expect(service.snapshotIfDue(tx(), note, now)).resolves.toBe(false);
    });

    it('saves again once the interval has passed', async () => {
      const old = new Date(now.getTime() - VERSION_INTERVAL_MS - 1000);
      prisma.noteVersion.findFirst.mockResolvedValue({ title: 'Plan', content: 'Older text', createdAt: old });
      await expect(service.snapshotIfDue(tx(), note, now)).resolves.toBe(true);
    });

    it('does not save the same text twice', async () => {
      const old = new Date(now.getTime() - 2 * VERSION_INTERVAL_MS);
      prisma.noteVersion.findFirst.mockResolvedValue({ title: 'Plan', content: 'Current text', createdAt: old });
      await expect(service.snapshotIfDue(tx(), note, now)).resolves.toBe(false);
    });
  });

  it('lists versions newest first with their size', async () => {
    prisma.note.findFirst.mockResolvedValue(note);
    prisma.noteVersion.findMany.mockResolvedValue([
      { id: 'v1', noteId: 'n1', title: 'Plan', content: 'abc', createdAt: now },
    ]);
    await expect(service.list(USER, 'n1')).resolves.toEqual([
      { id: 'v1', title: 'Plan', characters: 3, createdAt: now },
    ]);
  });

  it('404s for a version of another note', async () => {
    prisma.note.findFirst.mockResolvedValue(note);
    prisma.noteVersion.findFirst.mockResolvedValue(null);
    await expect(service.get(USER, 'n1', 'v9')).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('restore', () => {
    const version = { id: 'v1', noteId: 'n1', title: 'Old plan', content: 'Old [[Link]]', createdAt: now };

    beforeEach(() => {
      prisma.note.findFirst.mockResolvedValue(note);
      prisma.noteVersion.findFirst.mockResolvedValue(version);
      prisma.note.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...note, ...data, tags: [], notebook: null, share: null }),
      );
    });

    it('saves the current text first, then puts the old version back', async () => {
      const restored = await service.restore(USER, 'n1', 'v1');
      expect(prisma.noteVersion.create).toHaveBeenCalledWith({
        data: { noteId: 'n1', title: 'Plan', content: 'Current text', createdAt: expect.any(Date) },
      });
      expect(links.sync).toHaveBeenCalledWith(prisma, 'n1', 'Old [[Link]]');
      expect(restored).toMatchObject({ title: 'Old plan', content: 'Old [[Link]]' });
    });

    it('refuses for a note in the trash', async () => {
      prisma.note.findFirst.mockResolvedValue({ ...note, deletedAt: now });
      await expect(service.restore(USER, 'n1', 'v1')).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
