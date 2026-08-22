import { NotFoundException } from '@nestjs/common';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { newShareToken, SharesService } from './shares.service';

const USER = 'user-1';
const createdAt = new Date('2026-02-14T10:00:00Z');

describe('SharesService', () => {
  let prisma: PrismaMock;
  let service: SharesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new SharesService(asPrismaService(prisma));
  });

  it('returns null for a note that is not shared', async () => {
    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: null });
    prisma.shareLink.findUnique.mockResolvedValue(null);
    await expect(service.get(USER, 'n1')).resolves.toBeNull();
  });

  it('creates a link or returns the existing one', async () => {
    prisma.note.findFirst.mockResolvedValue({ id: 'n1', deletedAt: null });
    prisma.shareLink.upsert.mockResolvedValue({ id: 's1', noteId: 'n1', token: 'tok', viewCount: 4, createdAt });
    await expect(service.create(USER, 'n1')).resolves.toEqual({ token: 'tok', viewCount: 4, createdAt });
    expect(prisma.shareLink.upsert).toHaveBeenCalledWith({
      where: { noteId: 'n1' },
      create: { noteId: 'n1', token: expect.any(String) },
      update: {},
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
      note: {
        title: 'Recipe',
        content: 'Bread',
        updatedAt: createdAt,
        deletedAt: null as Date | null,
        tags: [{ tag: { name: 'baking' } }],
      },
    };

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
  });
});

describe('newShareToken', () => {
  it('makes URL-safe tokens that are hard to guess', () => {
    const tokens = new Set(Array.from({ length: 50 }, newShareToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});
