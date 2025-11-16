import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { NotebooksService } from './notebooks.service';

const USER = 'user-1';
const now = new Date('2026-02-01T10:00:00Z');

function notebook(id: string, overrides: Partial<{ name: string; parentId: string | null }> = {}) {
  return { id, userId: USER, name: id, parentId: null, createdAt: now, updatedAt: now, ...overrides };
}

describe('NotebooksService', () => {
  let prisma: PrismaMock;
  let service: NotebooksService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new NotebooksService(asPrismaService(prisma));
  });

  describe('list', () => {
    it('returns notebooks with the number of notes outside the trash', async () => {
      prisma.notebook.findMany.mockResolvedValue([{ ...notebook('work'), _count: { notes: 3 } }]);
      const result = await service.list(USER);
      expect(result).toEqual([
        { id: 'work', name: 'work', parentId: null, createdAt: now, updatedAt: now, noteCount: 3 },
      ]);
      expect(prisma.notebook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER },
          include: { _count: { select: { notes: true } } },
        }),
      );
    });
  });

  describe('create', () => {
    it('creates a top-level notebook', async () => {
      prisma.notebook.findFirst.mockResolvedValue(null);
      prisma.notebook.create.mockResolvedValue(notebook('new', { name: 'Ideas' }));
      const result = await service.create(USER, { name: 'Ideas' });
      expect(prisma.notebook.create).toHaveBeenCalledWith({ data: { userId: USER, name: 'Ideas', parentId: null } });
      expect(result).toMatchObject({ name: 'Ideas', noteCount: 0 });
      expect(result).not.toHaveProperty('userId');
    });

    it('nests a notebook under a top-level one', async () => {
      prisma.notebook.findFirst.mockResolvedValueOnce(notebook('work')).mockResolvedValueOnce(null);
      prisma.notebook.create.mockResolvedValue(notebook('meetings', { parentId: 'work' }));
      await service.create(USER, { name: 'Meetings', parentId: 'work' });
      expect(prisma.notebook.create).toHaveBeenCalledWith({
        data: { userId: USER, name: 'Meetings', parentId: 'work' },
      });
    });

    it('does not nest more than one level deep', async () => {
      prisma.notebook.findFirst.mockResolvedValue(notebook('meetings', { parentId: 'work' }));
      await expect(service.create(USER, { name: 'Deeper', parentId: 'meetings' })).rejects.toThrow(
        'Notebooks can only be nested one level deep',
      );
    });

    it('404s for a parent that belongs to someone else', async () => {
      prisma.notebook.findFirst.mockResolvedValue(null);
      await expect(service.create(USER, { name: 'X', parentId: 'theirs' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a duplicate name next to an existing notebook, ignoring case', async () => {
      prisma.notebook.findFirst.mockResolvedValue(notebook('work', { name: 'Work' }));
      await expect(service.create(USER, { name: 'work' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.notebook.findFirst).toHaveBeenCalledWith({
        where: { userId: USER, parentId: null, name: { equals: 'work', mode: 'insensitive' } },
      });
    });
  });

  describe('update', () => {
    const withCount = (nb: ReturnType<typeof notebook>) => ({ ...nb, _count: { notes: 0 } });

    it('renames a notebook', async () => {
      prisma.notebook.findFirst.mockResolvedValueOnce(notebook('work', { name: 'Work' })).mockResolvedValueOnce(null);
      prisma.notebook.findFirstOrThrow.mockResolvedValue(withCount(notebook('work', { name: 'Job' })));
      const result = await service.update(USER, 'work', { name: 'Job' });
      expect(prisma.notebook.update).toHaveBeenCalledWith({
        where: { id: 'work' },
        data: { name: 'Job', parentId: null },
      });
      expect(result.name).toBe('Job');
    });

    it('moves a nested notebook back to the top level', async () => {
      prisma.notebook.findFirst
        .mockResolvedValueOnce(notebook('meetings', { parentId: 'work' }))
        .mockResolvedValueOnce(null);
      prisma.notebook.findFirstOrThrow.mockResolvedValue(withCount(notebook('meetings')));
      await service.update(USER, 'meetings', { parentId: null });
      expect(prisma.notebook.update).toHaveBeenCalledWith({
        where: { id: 'meetings' },
        data: { name: 'meetings', parentId: null },
      });
    });

    it('cannot nest a notebook inside itself', async () => {
      prisma.notebook.findFirst.mockResolvedValue(notebook('work'));
      await expect(service.update(USER, 'work', { parentId: 'work' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cannot nest a notebook that has notebooks inside it', async () => {
      prisma.notebook.findFirst.mockResolvedValueOnce(notebook('work')).mockResolvedValueOnce(notebook('personal'));
      prisma.notebook.count.mockResolvedValue(2);
      await expect(service.update(USER, 'work', { parentId: 'personal' })).rejects.toThrow(
        'A notebook that has notebooks inside it cannot be nested',
      );
    });
  });

  describe('remove', () => {
    it('deletes the notebook', async () => {
      prisma.notebook.findFirst.mockResolvedValue(notebook('work'));
      await service.remove(USER, 'work');
      expect(prisma.notebook.delete).toHaveBeenCalledWith({ where: { id: 'work' } });
    });

    it('404s for an unknown notebook', async () => {
      prisma.notebook.findFirst.mockResolvedValue(null);
      await expect(service.remove(USER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
