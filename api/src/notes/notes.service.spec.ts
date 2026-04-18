import { ConflictException, NotFoundException } from '@nestjs/common';
import { LinksService } from '../links/links.service';
import { NotebooksService } from '../notebooks/notebooks.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { TagsService } from '../tags/tags.service';
import { VersionsService } from '../versions/versions.service';
import { ListNotesQuery } from './dto/note.dto';
import { NotesService } from './notes.service';

const USER = 'user-1';
const earlier = new Date('2026-01-10T09:00:00Z');

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    userId: USER,
    notebookId: null,
    title: 'Plan',
    content: 'Old content',
    pinned: false,
    favorite: false,
    deletedAt: null,
    createdAt: earlier,
    updatedAt: earlier,
    ...overrides,
  };
}

function withRelations(overrides: Record<string, unknown> = {}) {
  return { ...note(overrides), tags: [], notebook: null, share: null };
}

function query(overrides: Partial<ListNotesQuery> = {}): ListNotesQuery {
  return Object.assign(new ListNotesQuery(), overrides);
}

describe('NotesService', () => {
  let prisma: PrismaMock;
  let notebooks: jest.Mocked<Pick<NotebooksService, 'findOwned' | 'idsWithChildren'>>;
  let tags: jest.Mocked<Pick<TagsService, 'setNoteTags'>>;
  let links: jest.Mocked<Pick<LinksService, 'sync'>>;
  let versions: jest.Mocked<Pick<VersionsService, 'snapshotIfDue'>>;
  let service: NotesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    notebooks = { findOwned: jest.fn(), idsWithChildren: jest.fn() };
    tags = { setNoteTags: jest.fn() };
    links = { sync: jest.fn() };
    versions = { snapshotIfDue: jest.fn() };
    service = new NotesService(
      asPrismaService(prisma),
      notebooks as unknown as NotebooksService,
      tags as unknown as TagsService,
      links as unknown as LinksService,
      versions as unknown as VersionsService,
    );
    prisma.note.update.mockImplementation(({ data }) => Promise.resolve(withRelations(data)));
  });

  describe('list', () => {
    beforeEach(() => {
      prisma.note.findMany.mockResolvedValue([withRelations({ content: '# Plan\n\nThe body' })]);
      prisma.note.count.mockResolvedValue(1);
    });

    it('lists notes outside the trash with pinned ones first', async () => {
      const page = await service.list(USER, query());
      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER, deletedAt: null },
          orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
          skip: 0,
          take: 50,
        }),
      );
      expect(page).toMatchObject({ total: 1, page: 1, pageSize: 50 });
      expect(page.items[0]).toMatchObject({ id: 'n1', excerpt: 'The body', tags: [] });
    });

    it('includes nested notebooks when filtering by a notebook', async () => {
      notebooks.idsWithChildren.mockResolvedValue(['work', 'meetings']);
      await service.list(USER, query({ notebookId: 'work' }));
      expect(prisma.note.findMany.mock.calls[0][0].where).toMatchObject({ notebookId: { in: ['work', 'meetings'] } });
    });

    it('filters notes without a notebook', async () => {
      await service.list(USER, query({ notebookId: 'none' }));
      expect(prisma.note.findMany.mock.calls[0][0].where).toMatchObject({ notebookId: null });
    });

    it('filters by normalised tag, pinned and favourite', async () => {
      await service.list(USER, query({ tag: '#Books', pinned: true, favorite: false }));
      expect(prisma.note.findMany.mock.calls[0][0].where).toMatchObject({
        tags: { some: { tag: { name: 'books' } } },
        pinned: true,
        favorite: false,
      });
    });

    it('sorts titles A to Z by default and pages', async () => {
      await service.list(USER, query({ sort: 'title', page: 3, pageSize: 10 }));
      const args = prisma.note.findMany.mock.calls[0][0];
      expect(args.orderBy[1]).toEqual({ title: 'asc' });
      expect(args.skip).toBe(20);
      expect(args.take).toBe(10);
    });
  });

  describe('get', () => {
    it('404s for a note of another user', async () => {
      prisma.note.findFirst.mockResolvedValue(null);
      await expect(service.get(USER, 'n1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.note.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'n1', userId: USER } }),
      );
    });
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.note.create.mockImplementation(({ data }) => Promise.resolve(note({ ...data, id: 'new' })));
      prisma.note.findUniqueOrThrow.mockResolvedValue(withRelations({ id: 'new' }));
    });

    it('creates an untitled empty note by default', async () => {
      await service.create(USER, {});
      expect(prisma.note.create).toHaveBeenCalledWith({
        data: { userId: USER, title: 'Untitled', content: '', notebookId: null, pinned: false, favorite: false },
      });
      expect(tags.setNoteTags).not.toHaveBeenCalled();
      expect(links.sync).not.toHaveBeenCalled();
    });

    it('checks the notebook and stores tags and links', async () => {
      await service.create(USER, { title: 'Hi', content: 'See [[Other]]', notebookId: 'nb', tags: ['a'] });
      expect(notebooks.findOwned).toHaveBeenCalledWith(USER, 'nb');
      expect(tags.setNoteTags).toHaveBeenCalledWith(prisma, USER, 'new', ['a']);
      expect(links.sync).toHaveBeenCalledWith(prisma, 'new', 'See [[Other]]');
    });

    it('fails when the notebook is not the user’s', async () => {
      notebooks.findOwned.mockRejectedValue(new NotFoundException('Notebook not found'));
      await expect(service.create(USER, { notebookId: 'nb' })).rejects.toThrow('Notebook not found');
      expect(prisma.note.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.note.findFirst.mockResolvedValue(note());
    });

    it('saves a version, syncs links and bumps updatedAt when the content changes', async () => {
      await service.update(USER, 'n1', { content: 'New [[Link]]' });
      expect(versions.snapshotIfDue).toHaveBeenCalledWith(prisma, note());
      expect(links.sync).toHaveBeenCalledWith(prisma, 'n1', 'New [[Link]]');
      const data = prisma.note.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ title: 'Plan', content: 'New [[Link]]', updatedAt: expect.any(Date) });
    });

    it('does not count pinning as an edit', async () => {
      await service.update(USER, 'n1', { pinned: true, favorite: true });
      const data = prisma.note.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ pinned: true, favorite: true });
      expect(data.updatedAt).toBeUndefined();
      expect(versions.snapshotIfDue).not.toHaveBeenCalled();
      expect(links.sync).not.toHaveBeenCalled();
    });

    it('falls back to "Untitled" when the title is cleared', async () => {
      await service.update(USER, 'n1', { title: '' });
      expect(prisma.note.update.mock.calls[0][0].data.title).toBe('Untitled');
    });

    it('moves the note out of its notebook with null', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ notebookId: 'nb' }));
      await service.update(USER, 'n1', { notebookId: null });
      const data = prisma.note.update.mock.calls[0][0].data;
      expect(data.notebook).toEqual({ disconnect: true });
      expect(data.updatedAt).toEqual(expect.any(Date));
    });

    it('moves the note into another notebook after checking it', async () => {
      await service.update(USER, 'n1', { notebookId: 'nb2' });
      expect(notebooks.findOwned).toHaveBeenCalledWith(USER, 'nb2');
      expect(prisma.note.update.mock.calls[0][0].data.notebook).toEqual({ connect: { id: 'nb2' } });
    });

    it('only bumps updatedAt for tags when they actually change', async () => {
      prisma.noteTag.findMany.mockResolvedValue([{ tag: { name: 'b' } }, { tag: { name: 'a' } }]);
      tags.setNoteTags.mockResolvedValue(['a', 'b']);
      await service.update(USER, 'n1', { tags: ['a', 'b'] });
      expect(prisma.note.update.mock.calls[0][0].data.updatedAt).toBeUndefined();

      tags.setNoteTags.mockResolvedValue(['a', 'b', 'c']);
      await service.update(USER, 'n1', { tags: ['a', 'b', 'c'] });
      expect(prisma.note.update.mock.calls[1][0].data.updatedAt).toEqual(expect.any(Date));
    });

    it('refuses to edit a note in the trash', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ deletedAt: new Date() }));
      await expect(service.update(USER, 'n1', { content: 'x' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('trash', () => {
    it('sets deletedAt', async () => {
      prisma.note.findFirst.mockResolvedValue(note());
      await service.trash(USER, 'n1');
      expect(prisma.note.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { deletedAt: expect.any(Date) } });
    });

    it('404s for unknown notes', async () => {
      prisma.note.findFirst.mockResolvedValue(null);
      await expect(service.trash(USER, 'n1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('titles', () => {
    it('returns recent notes when there is no search term', async () => {
      prisma.note.findMany.mockResolvedValue([{ id: 'n1', title: 'Plan' }]);
      await service.titles(USER, '  ');
      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { updatedAt: 'desc' }, take: 10 }),
      );
    });

    it('puts titles starting with the term before titles containing it', async () => {
      prisma.note.findMany
        .mockResolvedValueOnce([{ id: 'a', title: 'Atlas' }])
        .mockResolvedValueOnce([{ id: 'b', title: 'Project Atlas' }]);
      await expect(service.titles(USER, 'atl', 5)).resolves.toEqual([
        { id: 'a', title: 'Atlas' },
        { id: 'b', title: 'Project Atlas' },
      ]);
      expect(prisma.note.findMany.mock.calls[1][0]).toMatchObject({
        where: { id: { notIn: ['a'] } },
        take: 4,
      });
    });
  });
});
