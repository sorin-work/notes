import { BadRequestException, NotFoundException } from '@nestjs/common';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { TagsService } from './tags.service';

const USER = 'user-1';

describe('TagsService', () => {
  let prisma: PrismaMock;
  let service: TagsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new TagsService(asPrismaService(prisma));
  });

  it('lists tags in use with their note counts', async () => {
    prisma.tag.findMany.mockResolvedValue([
      { id: 't1', name: 'books', _count: { notes: 2 } },
      { id: 't2', name: 'unused', _count: { notes: 0 } },
    ]);
    await expect(service.list(USER)).resolves.toEqual([{ id: 't1', name: 'books', noteCount: 2 }]);
  });

  describe('rename', () => {
    it('renames to a free name', async () => {
      prisma.tag.findFirst.mockResolvedValue({ id: 't1', userId: USER, name: 'book' });
      prisma.tag.findUnique.mockResolvedValue(null);
      prisma.tag.findUniqueOrThrow.mockResolvedValue({ id: 't1', name: 'books', _count: { notes: 1 } });
      await expect(service.rename(USER, 't1', { name: 'Books' })).resolves.toEqual({
        id: 't1',
        name: 'books',
        noteCount: 1,
      });
      expect(prisma.tag.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { name: 'books' } });
    });

    it('merges into an existing tag with the new name', async () => {
      prisma.tag.findFirst.mockResolvedValue({ id: 't1', userId: USER, name: 'book' });
      prisma.tag.findUnique.mockResolvedValue({ id: 't2', userId: USER, name: 'books' });
      prisma.noteTag.findMany.mockResolvedValue([{ noteId: 'n1' }, { noteId: 'n2' }]);
      prisma.tag.findUniqueOrThrow.mockResolvedValue({ id: 't2', name: 'books', _count: { notes: 3 } });

      const result = await service.rename(USER, 't1', { name: 'books' });

      expect(prisma.noteTag.createMany).toHaveBeenCalledWith({
        data: [
          { noteId: 'n1', tagId: 't2' },
          { noteId: 'n2', tagId: 't2' },
        ],
        skipDuplicates: true,
      });
      expect(prisma.tag.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
      expect(result.id).toBe('t2');
    });

    it('rejects names without letters or numbers', async () => {
      prisma.tag.findFirst.mockResolvedValue({ id: 't1', userId: USER, name: 'book' });
      await expect(service.rename(USER, 't1', { name: '###' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('404s when removing a tag of another user', async () => {
    prisma.tag.findFirst.mockResolvedValue(null);
    await expect(service.remove(USER, 't1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.tag.delete).not.toHaveBeenCalled();
  });

  describe('setNoteTags', () => {
    it('creates missing tags and replaces the note’s tags', async () => {
      prisma.tag.upsert.mockImplementation(({ create }) => Promise.resolve({ id: `id-${create.name}` }));

      const names = await service.setNoteTags(asPrismaService(prisma), USER, 'n1', ['Work', 'work', '#Ideas']);

      expect(names).toEqual(['work', 'ideas']);
      expect(prisma.tag.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.noteTag.deleteMany).toHaveBeenCalledWith({
        where: { noteId: 'n1', tagId: { notIn: ['id-work', 'id-ideas'] } },
      });
      expect(prisma.noteTag.createMany).toHaveBeenCalledWith({
        data: [
          { noteId: 'n1', tagId: 'id-work' },
          { noteId: 'n1', tagId: 'id-ideas' },
        ],
        skipDuplicates: true,
      });
    });

    it('clears all tags for an empty list', async () => {
      await service.setNoteTags(asPrismaService(prisma), USER, 'n1', []);
      expect(prisma.noteTag.deleteMany).toHaveBeenCalledWith({ where: { noteId: 'n1', tagId: { notIn: [] } } });
    });
  });
});
