import JSZip from 'jszip';
import { LinksService } from '../links/links.service';
import { NotebooksService } from '../notebooks/notebooks.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { TagsService } from '../tags/tags.service';
import { ImportService, notebookPath, splitPath } from './import.service';

const USER = 'user-1';

function file(originalname: string, content: string | Buffer) {
  return { originalname, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8') };
}

describe('splitPath', () => {
  it('separates folders from the file name', () => {
    expect(splitPath('Work/Projects/Plan.md')).toEqual({ folders: ['Work', 'Projects'], name: 'Plan' });
    expect(splitPath('./notes.txt')).toEqual({ folders: [], name: 'notes' });
  });
});

describe('notebookPath', () => {
  it('keeps the folders as deep as notebooks nest', () => {
    expect(notebookPath([])).toEqual([]);
    expect(notebookPath(['Work'])).toEqual(['Work']);
    expect(notebookPath(['Work', 'Meetings'])).toEqual(['Work', 'Meetings']);
    expect(notebookPath(['Work', 'Clients', 'Acme'])).toEqual(['Work', 'Clients', 'Acme']);
    expect(notebookPath(['Work', 'Clients', 'Acme', '2026'])).toEqual(['Work', 'Clients', 'Acme', '2026']);
  });

  it('folds what is deeper into the fourth level', () => {
    expect(notebookPath(['Work', 'Clients', 'Acme', '2026', 'Q1'])).toEqual(['Work', 'Clients', 'Acme', '2026 - Q1']);
    expect(notebookPath(['A', 'B', 'C', 'D', 'E', 'F'])).toEqual(['A', 'B', 'C', 'D - E - F']);
  });

  it('drops empty folder names', () => {
    expect(notebookPath([' Work ', '', '  ', 'Plans'])).toEqual(['Work', 'Plans']);
  });
});

describe('ImportService', () => {
  let prisma: PrismaMock;
  let tags: { setNoteTags: jest.Mock };
  let links: { sync: jest.Mock };
  let service: ImportService;
  let notebookCount: number;

  beforeEach(() => {
    prisma = createPrismaMock();
    tags = { setNoteTags: jest.fn() };
    links = { sync: jest.fn() };
    service = new ImportService(
      asPrismaService(prisma),
      tags as unknown as TagsService,
      links as unknown as LinksService,
      new NotebooksService(asPrismaService(prisma)),
    );
    notebookCount = 0;
    // The notebooks made so far, found again by parent and name the way the database would.
    const made: { id: string; parentId: string | null; name: string }[] = [];
    prisma.notebook.findFirst.mockImplementation(
      ({ where }: { where: { parentId: string | null; name: { equals: string } } }) =>
        Promise.resolve(
          made.find(
            (notebook) =>
              notebook.parentId === where.parentId && notebook.name.toLowerCase() === where.name.equals.toLowerCase(),
          ) ?? null,
        ),
    );
    prisma.notebook.create.mockImplementation(({ data }: { data: { parentId: string | null; name: string } }) => {
      const notebook = { id: `nb-${++notebookCount}`, parentId: data.parentId, name: data.name };
      made.push(notebook);
      return Promise.resolve(notebook);
    });
    prisma.note.create.mockImplementation(({ data }) => Promise.resolve({ id: `note-${data.title}` }));
  });

  it('requires at least one file', async () => {
    await expect(service.import(USER, [])).rejects.toThrow('Choose at least one Markdown file');
  });

  it('imports a Markdown file using its front matter', async () => {
    const text =
      '---\ntitle: Weekly plan\ntags: [work, plan]\npinned: true\ntemplate: true\ncreated: 2026-01-02\n---\nSee [[Atlas]]';
    const result = await service.import(USER, [file('plan.md', text)]);

    expect(result).toEqual({ imported: 1, notebooksCreated: 0, skipped: [] });
    expect(prisma.note.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER,
        notebookId: null,
        title: 'Weekly plan',
        content: 'See [[Atlas]]',
        pinned: true,
        favorite: false,
        isTemplate: true,
        createdAt: new Date('2026-01-02'),
        updatedAt: new Date('2026-01-02'),
      }),
    });
    expect(tags.setNoteTags).toHaveBeenCalledWith(prisma, USER, 'note-Weekly plan', ['work', 'plan']);
    expect(links.sync).toHaveBeenCalledWith(prisma, 'note-Weekly plan', 'See [[Atlas]]');
  });

  it('reads tags written as a comma separated string', async () => {
    await service.import(USER, [file('a.md', '---\ntags: reading, to-do\n---\nBody')]);
    expect(tags.setNoteTags).toHaveBeenCalledWith(prisma, USER, 'note-a', ['reading', 'to-do']);
  });

  it('uses the file name when there is no title', async () => {
    await service.import(USER, [file('Shopping list.txt', 'milk')]);
    expect(prisma.note.create.mock.calls[0][0].data.title).toBe('Shopping list');
  });

  it('creates notebooks from zip folders once and reuses them', async () => {
    const zip = new JSZip();
    zip.file('Work/Plan.md', 'a');
    zip.file('Work/Meetings/Monday.md', 'b');
    zip.file('Work/Meetings/Tuesday.md', 'c');
    zip.file('Inbox.md', 'd');
    zip.file('Work/diagram.png', 'binary');
    zip.file('.obsidian/workspace.md', 'ignored');
    zip.file('__MACOSX/Work/._Plan.md', 'ignored');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    const result = await service.import(USER, [file('export.zip', buffer)]);

    expect(result.imported).toBe(4);
    expect(result.notebooksCreated).toBe(2);
    expect(result.skipped).toEqual([{ file: 'Work/diagram.png', reason: 'Not a Markdown or text file' }]);
    expect(prisma.notebook.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: USER, parentId: null, name: 'Work' } }),
    );
    expect(prisma.notebook.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: USER, parentId: 'nb-1', name: 'Meetings' } }),
    );
  });

  it('adds to existing notebooks with the same name', async () => {
    prisma.notebook.findFirst.mockResolvedValue({ id: 'existing' });
    const zip = new JSZip();
    zip.file('work/Plan.md', 'a');
    const result = await service.import(USER, [file('n.zip', await zip.generateAsync({ type: 'nodebuffer' }))]);
    expect(result.notebooksCreated).toBe(0);
    expect(prisma.note.create.mock.calls[0][0].data.notebookId).toBe('existing');
  });

  it('finds and makes the notebooks of each note in the transaction of the note, under the lock on the tree', async () => {
    const zip = new JSZip();
    zip.file('A/B/C/D/n.md', 'a');
    zip.file('A/B/m.md', 'b');
    await service.import(USER, [file('n.zip', await zip.generateAsync({ type: 'nodebuffer' }))]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const locks = prisma.$queryRaw.mock.calls.filter(([sql]) =>
      (sql as string[]).join('?').includes('FOR NO KEY UPDATE'),
    );
    expect(locks).toHaveLength(2);
    // Each note takes the lock before it looks for a notebook, and is made after its notebooks.
    const order = (mock: jest.Mock, at: number) => mock.mock.invocationCallOrder[at];
    expect(order(prisma.$queryRaw, 0)).toBeLessThan(order(prisma.notebook.findFirst, 0));
    expect(order(prisma.notebook.create, 3)).toBeLessThan(order(prisma.note.create, 0));
    expect(prisma.note.create.mock.calls[0][0].data.notebookId).toBe('nb-4');
    expect(prisma.note.create.mock.calls[1][0].data.notebookId).toBe('nb-2');
  });

  it('skips files it cannot read', async () => {
    const result = await service.import(USER, [file('photo.jpg', 'x'), file('broken.zip', 'not a zip')]);
    expect(result).toEqual({
      imported: 0,
      notebooksCreated: 0,
      skipped: [
        { file: 'photo.jpg', reason: 'Not a Markdown, text or zip file' },
        { file: 'broken.zip', reason: 'Not a valid zip file' },
      ],
    });
  });
});
