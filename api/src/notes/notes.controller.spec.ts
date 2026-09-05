import { StreamableFile } from '@nestjs/common';
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
  };
  const links = { backlinks: jest.fn(), outgoing: jest.fn(), resolve: jest.fn() };
  const exporter = { exportNote: jest.fn() };
  const controller = new NotesController(
    notes as unknown as NotesService,
    links as unknown as LinksService,
    exporter as unknown as ExportService,
  );

  beforeEach(() => jest.resetAllMocks());

  it('scopes every call to the current user', async () => {
    const query = new ListNotesQuery();
    await controller.list(user, query);
    await controller.get(user, 'n1');
    await controller.create(user, { title: 'x' });
    await controller.update(user, 'n1', { pinned: true });
    await controller.trash(user, 'n1');
    expect(notes.list).toHaveBeenCalledWith('user-1', query);
    expect(notes.get).toHaveBeenCalledWith('user-1', 'n1');
    expect(notes.create).toHaveBeenCalledWith('user-1', { title: 'x' });
    expect(notes.update).toHaveBeenCalledWith('user-1', 'n1', { pinned: true });
    expect(notes.trash).toHaveBeenCalledWith('user-1', 'n1');
  });

  it('routes link lookups to the links service', async () => {
    await controller.backlinks(user, 'n1');
    await controller.outgoing(user, 'n1');
    await controller.resolve(user, { title: 'Atlas' });
    expect(links.backlinks).toHaveBeenCalledWith('user-1', 'n1');
    expect(links.outgoing).toHaveBeenCalledWith('user-1', 'n1');
    expect(links.resolve).toHaveBeenCalledWith('user-1', 'Atlas');
  });

  it('passes the title query and limit through', async () => {
    await controller.titles(user, { q: 'pro', limit: 5 });
    expect(notes.titles).toHaveBeenCalledWith('user-1', 'pro', 5);
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
