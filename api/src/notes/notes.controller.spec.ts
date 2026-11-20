import { ForbiddenException, StreamableFile } from '@nestjs/common';
import { AccessService } from '../access/access.service';
import { LinksService } from '../links/links.service';
import { ExportService } from '../transfer/export.service';
import { ListNotesQuery } from './dto/note.dto';
import { asciiFilename, NotesController } from './notes.controller';
import { NotesService } from './notes.service';

const user = { id: 'user-1', email: 'ada@example.com' };

describe('NotesController', () => {
  const notes = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    trash: jest.fn(),
    titles: jest.fn(),
    orphanedLinkCount: jest.fn(),
    renameLinks: jest.fn(),
    duplicate: jest.fn(),
    daily: jest.fn(),
  };
  const links = { backlinks: jest.fn(), outgoing: jest.fn(), resolve: jest.fn() };
  const exporter = { exportNote: jest.fn() };
  const owner = { ownerId: 'user-1', access: 'owner' };
  const access = {
    note: jest.fn(),
    notebook: jest.fn(),
    ownerForFilter: jest.fn(),
    visibleNotebookIds: jest.fn(),
    noteWriteGuard: jest.fn().mockReturnValue('guard'),
    notebookWriteGuard: jest.fn().mockReturnValue('guard'),
  };
  const controller = new NotesController(
    notes as unknown as NotesService,
    links as unknown as LinksService,
    exporter as unknown as ExportService,
    access as unknown as AccessService,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    access.noteWriteGuard.mockReturnValue('guard');
    access.notebookWriteGuard.mockReturnValue('guard');
    access.note.mockResolvedValue(owner);
    access.notebook.mockResolvedValue(owner);
    access.ownerForFilter.mockResolvedValue(owner);
    access.visibleNotebookIds.mockResolvedValue(null);
  });

  describe('for a member of a shared notebook', () => {
    const member = { ownerId: 'owner-1', access: 'edit' };
    beforeEach(() => {
      access.note.mockResolvedValue(member);
      access.notebook.mockResolvedValue(member);
      access.visibleNotebookIds.mockResolvedValue(new Set(['nb1']));
    });

    it('works on the owner’s note, with text and tags only', async () => {
      notes.update.mockResolvedValue({ id: 'n1', access: 'owner' });
      await expect(controller.update(user, 'n1', { content: 'x', tags: ['a'] })).resolves.toMatchObject({
        access: 'edit',
      });
      expect(notes.update).toHaveBeenCalledWith('owner-1', 'n1', { content: 'x', tags: ['a'] }, 'guard');
      expect(access.noteWriteGuard).toHaveBeenCalledWith('user-1', 'n1', 'edit');
      await expect(controller.update(user, 'n1', { pinned: true })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.update(user, 'n1', { notebookId: null })).rejects.toBeInstanceOf(ForbiddenException);
      expect(access.note).toHaveBeenCalledWith('user-1', 'n1', 'edit');
    });

    it('keeps links and backlinks to the notebooks shared with them', async () => {
      await controller.outgoing(user, 'n1');
      await controller.backlinks(user, 'n1');
      expect(links.outgoing).toHaveBeenCalledWith('owner-1', 'n1', ['nb1']);
      expect(links.backlinks).toHaveBeenCalledWith('owner-1', 'n1', ['nb1']);
    });

    it('adds notes to the shared notebook as the owner’s, and nothing an owner keeps for themselves', async () => {
      notes.create.mockResolvedValue({ id: 'n2' });
      await controller.create(user, { title: 'x', notebookId: 'nb1' });
      expect(notes.create).toHaveBeenCalledWith('owner-1', { title: 'x', notebookId: 'nb1' }, 'guard');
      await expect(controller.create(user, { notebookId: 'nb1', templateId: 't1' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  it('scopes every call to the current user', async () => {
    const query = new ListNotesQuery();
    await controller.list(user, query);
    await controller.get(user, 'n1');
    await controller.create(user, { title: 'x' });
    await controller.update(user, 'n1', { pinned: true });
    await controller.trash(user, 'n1');
    await controller.duplicate(user, 'n1');
    expect(notes.duplicate).toHaveBeenCalledWith('user-1', 'n1');
    const today = { date: '2026-11-20', title: '2026-11-20' };
    await controller.daily(user, today);
    expect(notes.daily).toHaveBeenCalledWith('user-1', today);
    expect(notes.list).toHaveBeenCalledWith('user-1', query);
    expect(notes.get).toHaveBeenCalledWith('user-1', 'n1');
    expect(notes.create).toHaveBeenCalledWith('user-1', { title: 'x' });
    expect(notes.update).toHaveBeenCalledWith('user-1', 'n1', { pinned: true }, 'guard');
    expect(notes.trash).toHaveBeenCalledWith('user-1', 'n1');
  });

  it('routes link lookups to the links service', async () => {
    await controller.backlinks(user, 'n1');
    await controller.outgoing(user, 'n1');
    await controller.resolve(user, { title: 'Atlas' });
    expect(links.backlinks).toHaveBeenCalledWith('user-1', 'n1', undefined);
    expect(links.outgoing).toHaveBeenCalledWith('user-1', 'n1', undefined);
    expect(links.resolve).toHaveBeenCalledWith('user-1', 'Atlas', undefined);
  });

  it('counts and rewrites the links a rename left behind', async () => {
    notes.orphanedLinkCount.mockResolvedValue(3);
    const renamed = { updated: 3, skipped: 0, title: 'Project Atlas', noteIds: ['n2', 'n3', 'n4'] };
    notes.renameLinks.mockResolvedValue(renamed);
    await expect(controller.orphanedLinks(user, 'n1', { from: 'Atlas' })).resolves.toEqual({ count: 3 });
    await expect(controller.renameLinks(user, 'n1', { from: 'Atlas' })).resolves.toEqual(renamed);
    expect(notes.orphanedLinkCount).toHaveBeenCalledWith('user-1', 'n1', 'Atlas');
    expect(notes.renameLinks).toHaveBeenCalledWith('user-1', 'n1', 'Atlas');
  });

  it('passes the title query and limit through', async () => {
    await controller.titles(user, { q: 'pro', limit: 5 });
    expect(notes.titles).toHaveBeenCalledWith('user-1', 'pro', 5, undefined);
  });

  it('exports a note as a Markdown download', async () => {
    exporter.exportNote.mockResolvedValue({ filename: 'Café plan.md', markdown: '# Hi\n' });
    const file = await controller.export(user, 'n1');
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.getHeaders().disposition).toBe(
      `attachment; filename="Caf_ plan.md"; filename*=UTF-8''Caf%C3%A9%20plan.md`,
    );
  });
});

describe('asciiFilename', () => {
  it('replaces characters that do not belong in a quoted header value', () => {
    expect(asciiFilename('Notes "draft" ✓.md')).toBe('Notes _draft_ _.md');
  });
});
