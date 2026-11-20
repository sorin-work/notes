import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LinksService } from '../links/links.service';
import { NotebooksService } from '../notebooks/notebooks.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { TagsService } from '../tags/tags.service';
import { VersionsService } from '../versions/versions.service';
import { ListNotesQuery } from './dto/note.dto';
import { NotesService } from './notes.service';

const USER = 'user-1';
const NOTEBOOK = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '22222222-2222-4222-8222-222222222222';
const earlier = new Date('2026-01-10T09:00:00Z');

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    userId: USER,
    notebookId: null,
    title: 'Plan',
    content: 'Old content',
    revision: 7,
    pinned: false,
    favorite: false,
    isTemplate: false,
    dailyDate: null,
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
  let links: jest.Mocked<Pick<LinksService, 'sync' | 'titleTaken'>>;
  let versions: jest.Mocked<Pick<VersionsService, 'snapshotIfDue' | 'snapshot'>>;
  let service: NotesService;

  beforeEach(() => {
    prisma = createPrismaMock();
    notebooks = { findOwned: jest.fn(), idsWithChildren: jest.fn() };
    tags = { setNoteTags: jest.fn() };
    links = { sync: jest.fn(), titleTaken: jest.fn() };
    versions = { snapshotIfDue: jest.fn(), snapshot: jest.fn() };
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
          where: { userId: USER, deletedAt: null, isTemplate: false },
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

    it('lists the templates when asked, and only them', async () => {
      await service.list(USER, query({ templates: true, tag: 'Weekly' }));
      expect(prisma.note.findMany.mock.calls[0][0].where).toEqual({
        userId: USER,
        deletedAt: null,
        isTemplate: true,
        tags: { some: { tag: { name: 'weekly' } } },
      });
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
        data: {
          userId: USER,
          title: 'Untitled',
          content: '',
          notebookId: null,
          pinned: false,
          favorite: false,
          isTemplate: false,
          dailyDate: null,
        },
      });
      expect(tags.setNoteTags).not.toHaveBeenCalled();
      expect(links.sync).not.toHaveBeenCalled();
    });

    describe('from a template', () => {
      const template = {
        ...note({ id: 't1', title: 'Weekly review {{date}}', isTemplate: true, pinned: true, favorite: true }),
        content: '# {{title}}\n\nWritten at {{time}}, see [[Deep Work]]. {{mood}}',
        tags: [{ tag: { name: 'checklist' } }, { tag: { name: 'weekly' } }],
      };
      const placeholders = { date: '2026-11-20', time: '19:30' };

      beforeEach(() => {
        prisma.note.findFirst.mockResolvedValue(template);
      });

      it('copies the text and the tags with the placeholders filled in, and nothing else', async () => {
        await service.create(USER, { templateId: 't1', placeholders, notebookId: 'nb' });

        // Only a template of this user, outside the trash, can be used.
        expect(prisma.note.findFirst.mock.calls[0][0].where).toEqual({
          userId: USER,
          deletedAt: null,
          isTemplate: true,
          id: 't1',
        });
        const content = '# Weekly review 2026-11-20\n\nWritten at 19:30, see [[Deep Work]]. {{mood}}';
        // The new note is a note: not a template, not pinned, no star.
        expect(prisma.note.create).toHaveBeenCalledWith({
          data: {
            userId: USER,
            title: 'Weekly review 2026-11-20',
            content,
            notebookId: 'nb',
            pinned: false,
            favorite: false,
            isTemplate: false,
            dailyDate: null,
          },
        });
        expect(tags.setNoteTags).toHaveBeenCalledWith(prisma, USER, 'new', ['checklist', 'weekly']);
        expect(links.sync).toHaveBeenCalledWith(prisma, 'new', content);
      });

      it('takes a title and tags that are sent along, and never works out the date itself', async () => {
        await service.create(USER, { templateId: 't1', title: 'Friday', tags: ['mine'] });
        expect(prisma.note.create.mock.calls[0][0].data).toMatchObject({
          title: 'Friday',
          content: '# Friday\n\nWritten at {{time}}, see [[Deep Work]]. {{mood}}',
        });
        expect(tags.setNoteTags).toHaveBeenCalledWith(prisma, USER, 'new', ['mine']);
      });

      it('names the note after the template, without a closing "template"', async () => {
        prisma.note.findFirst.mockResolvedValue({ ...template, title: 'Weekly review  Template' });
        await service.create(USER, { templateId: 't1' });
        expect(prisma.note.create.mock.calls[0][0].data).toMatchObject({
          title: 'Weekly review',
          content: '# Weekly review\n\nWritten at {{time}}, see [[Deep Work]]. {{mood}}',
        });

        prisma.note.findFirst.mockResolvedValue({ ...template, title: 'Template' });
        await service.create(USER, { templateId: 't1' });
        expect(prisma.note.create.mock.calls[1][0].data.title).toBe('Template');
      });

      it('404s when the template is not there, is not a template or is someone else’s', async () => {
        prisma.note.findFirst.mockResolvedValue(null);
        await expect(service.create(USER, { templateId: 't9' })).rejects.toThrow('Template not found');
        expect(prisma.note.create).not.toHaveBeenCalled();
      });

      it('refuses a note that the filled in placeholders would make too long', async () => {
        prisma.note.findFirst.mockResolvedValue({ ...template, content: '{{date}}'.repeat(125_000) });
        await expect(service.create(USER, { templateId: 't1', placeholders })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.note.create).not.toHaveBeenCalled();
      });
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

  describe('daily', () => {
    const day = new Date('2026-11-20T00:00:00.000Z');
    const today = { date: '2026-11-20', title: '20 November 2026' };

    beforeEach(() => {
      prisma.note.create.mockImplementation(({ data }) => Promise.resolve(note({ ...data, id: 'new' })));
      prisma.note.findUniqueOrThrow.mockResolvedValue(withRelations({ id: 'new', title: today.title, dailyDate: day }));
      prisma.note.update.mockImplementation(({ where, data }) => Promise.resolve(withRelations({ ...where, ...data })));
      prisma.user.findUniqueOrThrow.mockResolvedValue({ preferences: {} });
    });

    it('opens the note that is marked with the day, without making or changing anything', async () => {
      prisma.note.findFirst.mockResolvedValue(withRelations({ id: 'd1', title: 'Renamed since', dailyDate: day }));
      await expect(service.daily(USER, today)).resolves.toMatchObject({ id: 'd1', title: 'Renamed since' });
      expect(prisma.note.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER, dailyDate: day } }),
      );
      expect(prisma.note.create).not.toHaveBeenCalled();
      expect(prisma.note.update).not.toHaveBeenCalled();
    });

    it('takes a note titled with the day in another format for the note of that day', async () => {
      prisma.note.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(note({ id: 'older', title: '2026-11-20' }));
      await expect(service.daily(USER, today)).resolves.toMatchObject({ id: 'older' });

      // Looked for among the working notes, under every way the day can be written.
      expect(prisma.note.findFirst.mock.calls[1][0].where).toEqual({
        userId: USER,
        deletedAt: null,
        isTemplate: false,
        dailyDate: null,
        OR: ['2026-11-20', '20 November 2026', 'November 20, 2026'].map((title) => ({
          title: { equals: title, mode: 'insensitive' },
        })),
      });
      // Marked, which is no edit: no text, no updatedAt.
      expect(prisma.note.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'older' }, data: { dailyDate: day } }),
      );
      expect(prisma.note.create).not.toHaveBeenCalled();
    });

    it('makes the note as the preferences say, from the template and into the notebook', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        preferences: { dailyNotes: { notebookId: NOTEBOOK, templateId: TEMPLATE, dateFormat: 'long' } },
      });
      prisma.note.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          ...note({ id: TEMPLATE, title: 'Daily template', isTemplate: true }),
          content: '# {{title}}\n\nStarted {{time}}.',
          tags: [{ tag: { name: 'journal' } }],
        });
      prisma.notebook.findFirst.mockResolvedValue({ id: NOTEBOOK });

      await service.daily(USER, { ...today, placeholders: { time: '08:15' } });
      expect(prisma.note.create).toHaveBeenCalledWith({
        data: {
          userId: USER,
          title: '20 November 2026',
          content: '# 20 November 2026\n\nStarted 08:15.',
          notebookId: NOTEBOOK,
          pinned: false,
          favorite: false,
          isTemplate: false,
          dailyDate: day,
        },
      });
      expect(tags.setNoteTags).toHaveBeenCalledWith(prisma, USER, 'new', ['journal']);
      expect(prisma.notebook.findFirst).toHaveBeenCalledWith({ where: { id: NOTEBOOK, userId: USER } });
    });

    it('makes an empty note when the chosen notebook and template are gone', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        preferences: { dailyNotes: { notebookId: NOTEBOOK, templateId: TEMPLATE } },
      });
      prisma.note.findFirst.mockResolvedValue(null);
      prisma.notebook.findFirst.mockResolvedValue(null);
      await service.daily(USER, today);
      expect(prisma.note.create.mock.calls[0][0].data).toMatchObject({
        title: '20 November 2026',
        content: '',
        notebookId: null,
        dailyDate: day,
      });
    });

    it('gives the day a new note when the old one is in the trash, and leaves that one an ordinary note', async () => {
      prisma.note.findFirst
        .mockResolvedValueOnce(withRelations({ id: 'gone', dailyDate: day, deletedAt: new Date() }))
        .mockResolvedValue(null);
      await service.daily(USER, today);
      expect(prisma.note.update).toHaveBeenCalledWith({ where: { id: 'gone' }, data: { dailyDate: null } });
      expect(prisma.note.create.mock.calls[0][0].data).toMatchObject({ dailyDate: day });
    });

    it('does the same when the note of the day was turned into a template', async () => {
      prisma.note.findFirst
        .mockResolvedValueOnce(withRelations({ id: 'template-now', dailyDate: day, isTemplate: true }))
        .mockResolvedValue(null);
      await service.daily(USER, today);
      expect(prisma.note.update).toHaveBeenCalledWith({ where: { id: 'template-now' }, data: { dailyDate: null } });
      expect(prisma.note.create).toHaveBeenCalledTimes(1);
    });

    it('asks again when another request made the note in the same moment', async () => {
      const taken = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.note.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(withRelations({ id: 'theirs', dailyDate: day }));
      prisma.note.create.mockRejectedValueOnce(taken);
      await expect(service.daily(USER, today)).resolves.toMatchObject({ id: 'theirs' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('refuses a day that does not exist and a title that is not that day', async () => {
      await expect(service.daily(USER, { date: '2026-02-30', title: '2026-02-30' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.daily(USER, { date: '2026-11-20', title: '21 November 2026' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.daily(USER, { date: '2026-11-20', title: 'Anything' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('duplicate', () => {
    beforeEach(() => {
      prisma.note.create.mockImplementation(({ data }) => Promise.resolve(note({ ...data, id: 'copy' })));
      prisma.note.findUniqueOrThrow.mockResolvedValue(withRelations({ id: 'copy' }));
    });

    it('copies the text, tags, notebook and template flag, and leaves pin and star behind', async () => {
      const source = note({
        content: 'See [[Other]]',
        notebookId: 'nb',
        pinned: true,
        favorite: true,
        isTemplate: true,
      });
      prisma.note.findFirst.mockResolvedValue(source);
      prisma.note.findFirstOrThrow.mockResolvedValue({ ...source, tags: [{ tag: { name: 'a' } }] });

      await service.duplicate(USER, 'n1');
      expect(prisma.note.create).toHaveBeenCalledWith({
        data: {
          userId: USER,
          title: 'Plan (copy)',
          content: 'See [[Other]]',
          notebookId: 'nb',
          pinned: false,
          favorite: false,
          isTemplate: true,
          dailyDate: null,
        },
      });
      expect(tags.setNoteTags).toHaveBeenCalledWith(prisma, USER, 'copy', ['a']);
      expect(links.sync).toHaveBeenCalledWith(prisma, 'copy', 'See [[Other]]');
      // A new note: no version is written and no share link is made.
      expect(versions.snapshot).not.toHaveBeenCalled();
      expect(versions.snapshotIfDue).not.toHaveBeenCalled();
    });

    it('keeps the title of the copy within the length a title can have', async () => {
      const source = note({ title: 'x'.repeat(200) });
      prisma.note.findFirst.mockResolvedValue(source);
      prisma.note.findFirstOrThrow.mockResolvedValue({ ...source, tags: [] });
      await service.duplicate(USER, 'n1');
      const title = prisma.note.create.mock.calls[0][0].data.title as string;
      expect(title).toHaveLength(200);
      expect(title.endsWith(' (copy)')).toBe(true);
    });

    it('refuses for a note in the trash and 404s for other users', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ deletedAt: new Date() }));
      await expect(service.duplicate(USER, 'n1')).rejects.toBeInstanceOf(ConflictException);
      prisma.note.findFirst.mockResolvedValue(null);
      await expect(service.duplicate(USER, 'n1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.note.findFirst.mockResolvedValue(note());
      prisma.note.updateMany.mockResolvedValue({ count: 1 });
    });

    it('saves a version, syncs links and bumps updatedAt when the content changes', async () => {
      await service.update(USER, 'n1', { content: 'New [[Link]]' });
      expect(versions.snapshotIfDue).toHaveBeenCalledWith(prisma, note());
      expect(links.sync).toHaveBeenCalledWith(prisma, 'n1', 'New [[Link]]');
      // The text goes through the one write that checks the revision. Without one in the request, the last write wins.
      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: USER, deletedAt: null },
        data: { title: 'Plan', content: 'New [[Link]]' },
      });
      expect(prisma.note.update.mock.calls[0][0].data).toEqual({ updatedAt: expect.any(Date) });
    });

    it('writes the text only while the note is at the revision the save was based on', async () => {
      await service.update(USER, 'n1', { title: 'Plan B', revision: 7 });
      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: USER, revision: 7, deletedAt: null },
        data: { title: 'Plan B', content: 'Old content' },
      });
      // The check comes before anything else is written.
      expect(prisma.note.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        versions.snapshotIfDue.mock.invocationCallOrder[0],
      );
    });

    it('answers a save based on an old revision with the note as it is now', async () => {
      prisma.note.findFirst.mockResolvedValue(withRelations({ content: 'Theirs', revision: 8 }));
      await expect(service.update(USER, 'n1', { content: 'Mine', revision: 7, tags: ['x'] })).rejects.toMatchObject({
        status: 409,
        response: { code: 'stale_revision', note: { content: 'Theirs', revision: 8 } },
      });
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
      expect(tags.setNoteTags).not.toHaveBeenCalled();
      expect(versions.snapshotIfDue).not.toHaveBeenCalled();
    });

    it('answers the same way when another save gets in between the read and the write', async () => {
      prisma.note.updateMany.mockResolvedValue({ count: 0 });
      prisma.note.findFirst
        .mockResolvedValueOnce(note())
        .mockResolvedValueOnce(withRelations({ content: 'Theirs', revision: 8 }));
      await expect(service.update(USER, 'n1', { content: 'Mine', revision: 7 })).rejects.toMatchObject({
        response: { code: 'stale_revision', note: { revision: 8 } },
      });
      expect(versions.snapshotIfDue).not.toHaveBeenCalled();
      expect(links.sync).not.toHaveBeenCalled();
      expect(prisma.note.update).not.toHaveBeenCalled();
    });

    it('keeps the replaced text as a version when asked, whatever the interval', async () => {
      await service.update(USER, 'n1', { content: 'Mine', revision: 7, keepVersion: true });
      expect(versions.snapshot).toHaveBeenCalledWith(prisma, note());
      expect(versions.snapshotIfDue).not.toHaveBeenCalled();
    });

    it('does not count pinning as an edit, and never checks the revision for it', async () => {
      await service.update(USER, 'n1', { pinned: true, favorite: true, revision: 1 });
      const data = prisma.note.update.mock.calls[0][0].data;
      expect(data).toEqual({ pinned: true, favorite: true });
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
      expect(versions.snapshotIfDue).not.toHaveBeenCalled();
      expect(links.sync).not.toHaveBeenCalled();
    });

    it('makes a note a template without counting it as an edit or checking the revision', async () => {
      await service.update(USER, 'n1', { isTemplate: true, revision: 1 });
      expect(prisma.note.update.mock.calls[0][0].data).toEqual({ isTemplate: true });
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
      expect(versions.snapshotIfDue).not.toHaveBeenCalled();
    });

    it('falls back to "Untitled" when the title is cleared', async () => {
      await service.update(USER, 'n1', { title: '' });
      expect(prisma.note.updateMany.mock.calls[0][0].data.title).toBe('Untitled');
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

  describe('renameLinks', () => {
    const sync = note({ id: 'n2', title: 'Weekly sync', content: 'Talked about [[atlas]] and [[Atlas|it]].' });
    const ideas = note({ id: 'n3', title: 'Ideas', content: 'For [[Atlas#Later]]\n\n`[[Atlas]]`' });

    beforeEach(() => {
      prisma.note.findFirst.mockResolvedValue(note({ title: 'Project Atlas' }));
      prisma.note.findMany.mockResolvedValue([sync, ideas]);
      prisma.note.updateMany.mockResolvedValue({ count: 1 });
      links.titleTaken.mockResolvedValue(false);
    });

    it('rewrites the links of the notes that point at the old title', async () => {
      await expect(service.renameLinks(USER, 'n1', 'Atlas')).resolves.toEqual({
        updated: 2,
        skipped: 0,
        title: 'Project Atlas',
        noteIds: ['n2', 'n3'],
      });

      // The note is locked, and only then read, inside the transaction.
      expect(prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$queryRaw.mock.invocationCallOrder[0],
      );
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.note.findFirst.mock.invocationCallOrder[0],
      );
      expect(String(prisma.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
      expect(links.titleTaken).toHaveBeenCalledWith(USER, 'Atlas', { db: expect.anything() });
      expect(links.titleTaken).toHaveBeenCalledWith(USER, 'Project Atlas', { db: expect.anything(), except: 'n1' });
      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER,
            deletedAt: null,
            id: { not: 'n1' },
            outgoingLinks: { some: { targetKey: 'atlas' } },
          },
        }),
      );
      const rewritten = 'Talked about [[Project Atlas]] and [[Project Atlas|it]].';
      // No updatedAt in the data, and the revision that was read in the condition.
      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'n2', userId: USER, revision: 7, deletedAt: null },
        data: { content: rewritten },
      });
      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'n3', userId: USER, revision: 7, deletedAt: null },
        data: { content: 'For [[Project Atlas#Later]]\n\n`[[Atlas]]`' },
      });
      expect(versions.snapshot).toHaveBeenCalledWith(expect.anything(), sync, expect.any(Date));
      expect(links.sync).toHaveBeenCalledWith(expect.anything(), 'n2', rewritten);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('leaves a note alone that changed since it was read', async () => {
      prisma.note.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
      await expect(service.renameLinks(USER, 'n1', 'Atlas')).resolves.toMatchObject({
        updated: 1,
        skipped: 1,
        noteIds: ['n3'],
      });
      expect(versions.snapshot).toHaveBeenCalledTimes(1);
      expect(versions.snapshot).toHaveBeenCalledWith(expect.anything(), ideas, expect.any(Date));
      expect(links.sync).toHaveBeenCalledTimes(1);
    });

    it('rewrites nothing while a note still has the old title', async () => {
      links.titleTaken.mockResolvedValue(true);
      await expect(service.renameLinks(USER, 'n1', 'Atlas')).resolves.toEqual({
        updated: 0,
        skipped: 0,
        title: 'Project Atlas',
        noteIds: [],
      });
      await expect(service.orphanedLinkCount(USER, 'n1', 'Atlas')).resolves.toBe(0);
      expect(prisma.note.findMany).not.toHaveBeenCalled();
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
    });

    it('rewrites nothing when another note has the new title too', async () => {
      links.titleTaken.mockImplementation((_user, title) => Promise.resolve(title === 'Project Atlas'));
      await expect(service.renameLinks(USER, 'n1', 'Atlas')).resolves.toMatchObject({ updated: 0, skipped: 0 });
      await expect(service.orphanedLinkCount(USER, 'n1', 'Atlas')).resolves.toBe(0);
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
    });

    it('rewrites nothing for a note without a title', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ title: 'Untitled' }));
      await expect(service.orphanedLinkCount(USER, 'n1', 'Atlas')).resolves.toBe(0);
      await expect(service.renameLinks(USER, 'n1', 'Atlas')).resolves.toMatchObject({ updated: 0, noteIds: [] });
      expect(links.titleTaken).not.toHaveBeenCalled();
    });

    it('rewrites nothing when the new title cannot be written as a link', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ title: 'Atlas | v2' }));
      await expect(service.renameLinks(USER, 'n1', 'Atlas')).resolves.toMatchObject({ updated: 0 });
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
    });

    it('skips a note that would grow past the size limit', async () => {
      const full = note({ id: 'n4', content: `[[Atlas]]${'x'.repeat(999_990)}` });
      prisma.note.findMany.mockResolvedValue([full, sync]);
      await expect(service.orphanedLinkCount(USER, 'n1', 'Atlas')).resolves.toBe(1);
      // The count leaves it out, and the rewrite says that one note keeps its old link.
      await expect(service.renameLinks(USER, 'n1', 'Atlas')).resolves.toMatchObject({
        updated: 1,
        skipped: 1,
        noteIds: ['n2'],
      });
    });

    it('counts the notes it would rewrite without writing', async () => {
      await expect(service.orphanedLinkCount(USER, 'n1', 'Atlas')).resolves.toBe(2);
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses for a note in the trash and 404s for other users', async () => {
      prisma.note.findFirst.mockResolvedValue(note({ deletedAt: new Date() }));
      await expect(service.renameLinks(USER, 'n1', 'Atlas')).rejects.toBeInstanceOf(ConflictException);
      prisma.note.findFirst.mockResolvedValue(null);
      await expect(service.orphanedLinkCount(USER, 'n1', 'Atlas')).rejects.toBeInstanceOf(NotFoundException);
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
