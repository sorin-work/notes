import JSZip from 'jszip';
import { LinksService } from '../links/links.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import type { AttachmentsService } from '../attachments/attachments.service';
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
  it('keeps up to two levels', () => {
    expect(notebookPath([])).toEqual([]);
    expect(notebookPath(['Work'])).toEqual(['Work']);
    expect(notebookPath(['Work', 'Meetings'])).toEqual(['Work', 'Meetings']);
  });

  it('folds deeper folders into the second level', () => {
    expect(notebookPath(['Work', 'Clients', 'Acme'])).toEqual(['Work', 'Clients - Acme']);
  });
});

describe('ImportService', () => {
  let prisma: PrismaMock;
  let tags: { setNoteTags: jest.Mock };
  let links: { sync: jest.Mock };
  let attachments: { store: jest.Mock; hasRoom: jest.Mock; removeFiles: jest.Mock };
  let service: ImportService;
  let notebookCount: number;

  beforeEach(() => {
    prisma = createPrismaMock();
    tags = { setNoteTags: jest.fn() };
    links = { sync: jest.fn() };
    attachments = {
      store: jest.fn((name: string, bytes: Buffer, id: string) =>
        Promise.resolve({ id, fileName: name.split('/').pop(), contentType: 'image/png', size: bytes.length }),
      ),
      hasRoom: jest.fn().mockResolvedValue(true),
      removeFiles: jest.fn(),
    };
    service = new ImportService(
      asPrismaService(prisma),
      tags as unknown as TagsService,
      links as unknown as LinksService,
      attachments as unknown as AttachmentsService,
    );
    notebookCount = 0;
    prisma.notebook.findFirst.mockResolvedValue(null);
    prisma.notebook.create.mockImplementation(() => Promise.resolve({ id: `nb-${++notebookCount}` }));
    prisma.note.create.mockImplementation(({ data }) => Promise.resolve({ id: `note-${data.title}` }));
  });

  it('requires at least one file', async () => {
    await expect(service.import(USER, [])).rejects.toThrow('Choose at least one Markdown, Evernote or zip file');
  });

  it('imports a Markdown file using its front matter', async () => {
    const text =
      '---\ntitle: Weekly plan\ntags: [work, plan]\npinned: true\ntemplate: true\ncreated: 2026-01-02\n---\nSee [[Atlas]]';
    const result = await service.import(USER, [file('plan.md', text)]);

    expect(result).toEqual({
      imported: 1,
      notebooksCreated: 0,
      duplicates: 0,
      attachmentsSkipped: 0,
      attachmentsImported: 0,
      skipped: [],
    });
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
    expect(result.skipped).toEqual([{ file: 'Work/diagram.png', reason: 'No note links to it' }]);
    expect(prisma.notebook.create).toHaveBeenCalledWith({ data: { userId: USER, parentId: null, name: 'Work' } });
    expect(prisma.notebook.create).toHaveBeenCalledWith({ data: { userId: USER, parentId: 'nb-1', name: 'Meetings' } });
  });

  it('adds to existing notebooks with the same name', async () => {
    prisma.notebook.findFirst.mockResolvedValue({ id: 'existing' });
    const zip = new JSZip();
    zip.file('work/Plan.md', 'a');
    const result = await service.import(USER, [file('n.zip', await zip.generateAsync({ type: 'nodebuffer' }))]);
    expect(result.notebooksCreated).toBe(0);
    expect(prisma.note.create.mock.calls[0][0].data.notebookId).toBe('existing');
  });

  it('skips files it cannot read', async () => {
    const result = await service.import(USER, [
      file('photo.jpg', 'x'),
      file('broken.zip', 'not a zip'),
      file('song.mp3', 'x'),
    ]);
    expect(result).toEqual({
      imported: 0,
      notebooksCreated: 0,
      duplicates: 0,
      attachmentsSkipped: 0,
      attachmentsImported: 0,
      skipped: [
        { file: 'broken.zip', reason: 'Not a valid zip file' },
        { file: 'song.mp3', reason: 'Not a Markdown, text, Evernote or zip file' },
        { file: 'photo.jpg', reason: 'No note links to it' },
      ],
    });
  });

  describe('the same file twice', () => {
    it('leaves out notes whose title, notebook and text are there already, unless told not to', async () => {
      prisma.note.findFirst.mockResolvedValueOnce({ id: 'there' }).mockResolvedValueOnce(null);
      const result = await service.import(USER, [file('a.md', 'same'), file('b.md', 'new')]);

      expect(result).toMatchObject({ imported: 1, duplicates: 1 });
      expect(prisma.note.findFirst.mock.calls[0][0].where).toEqual({
        userId: USER,
        notebookId: null,
        title: 'a',
        content: 'same',
        deletedAt: null,
      });
      expect(prisma.note.create.mock.calls.map(([call]) => call.data.title)).toEqual(['b']);

      prisma.note.findFirst.mockResolvedValue({ id: 'there' });
      prisma.note.create.mockClear();
      const again = await service.import(USER, [file('a.md', 'same')], { skipExisting: false });
      expect(again).toMatchObject({ imported: 1, duplicates: 0 });
    });
  });

  describe('Evernote', () => {
    const enex = (notes: string) =>
      `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export application="Evernote">${notes}</en-export>`;
    const note = (title: string, html: string, extra = '') =>
      `<note><title>${title}</title><content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${html}</en-note>]]></content>${extra}</note>`;

    it('takes the notes into a notebook named after the file, with tags and dates, as Markdown', async () => {
      const xml = enex(
        note(
          'Trip &amp; plans',
          '<h1>Packing</h1><div><en-todo checked="true"/>Passport</div><p>See <b>this</b>&nbsp;&lt;b&gt;</p><en-media hash="ab" type="image/png"/>',
          '<created>20240102T101112Z</created><updated>20240305T080000Z</updated><tag>travel</tag><tag>Two Words</tag><resource><data encoding="base64">aGk=</data></resource>',
        ) + note('Second', '<div>Plain</div>'),
      );
      const result = await service.import(USER, [file('Holidays.enex', xml)]);

      expect(result).toMatchObject({ imported: 2, notebooksCreated: 1, attachmentsSkipped: 1, skipped: [] });
      expect(prisma.notebook.create).toHaveBeenCalledWith({ data: { userId: USER, parentId: null, name: 'Holidays' } });
      const first = prisma.note.create.mock.calls[0][0].data;
      expect(first).toMatchObject({
        title: 'Trip & plans',
        content: '# Packing\n\n[x] Passport\n\nSee **this** <b>',
        createdAt: new Date('2024-01-02T10:11:12Z'),
        updatedAt: new Date('2024-03-05T08:00:00Z'),
      });
      expect(tags.setNoteTags).toHaveBeenCalledWith(prisma, USER, 'note-Trip & plans', ['travel', 'Two Words']);
    });

    it('keeps a title with a slash or a dot as the title, in the notebook named after the file', async () => {
      const result = await service.import(USER, [file('Work.enex', enex(note('Q1/Q2 plan', 'a') + note('.', 'b')))]);
      expect(result).toMatchObject({ imported: 2, notebooksCreated: 1 });
      expect(prisma.notebook.create).toHaveBeenCalledTimes(1);
      expect(prisma.notebook.create).toHaveBeenCalledWith({ data: { userId: USER, parentId: null, name: 'Work' } });
      expect(prisma.note.create.mock.calls.map(([call]) => [call.data.title, call.data.notebookId])).toEqual([
        ['Q1/Q2 plan', 'nb-1'],
        ['.', 'nb-1'],
      ]);
    });

    it('drops scripts and styles, so nothing of the HTML survives', async () => {
      await service.import(USER, [
        file(
          'x.enex',
          enex(
            note(
              'X',
              '<script>alert(1)</script><style>p{}</style><iframe src="https://e.x"></iframe><p onclick="x()">Hi</p>',
            ),
          ),
        ),
      ]);
      expect(prisma.note.create.mock.calls[0][0].data.content).toBe('Hi');
    });

    it('refuses a file that declares entities, and one that uses an entity XML does not know', async () => {
      const bomb =
        '<?xml version="1.0"?><!DOCTYPE en-export [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]><en-export><note><title>&b;</title></note></en-export>';
      const external =
        '<?xml version="1.0"?><!DOCTYPE en-export [<!ENTITY x SYSTEM "file:///etc/passwd">]><en-export><note><title>&x;</title></note></en-export>';
      const unknown = '<en-export><note><title>&nbsp;</title></note></en-export>';
      const result = await service.import(USER, [
        file('bomb.enex', bomb),
        file('external.enex', external),
        file('unknown.enex', unknown),
      ]);
      expect(result.imported).toBe(0);
      expect(result.skipped.map((entry) => entry.file)).toEqual(['bomb.enex', 'external.enex', 'unknown.enex']);
      expect(result.skipped[0].reason).toBe('The file declares a DTD of its own');
      expect(result.skipped[2].reason).toMatch(/^Not a readable Evernote export/);
      expect(prisma.note.create).not.toHaveBeenCalled();
    });

    it('refuses XML that is not an Evernote export', async () => {
      const result = await service.import(USER, [file('feed.enex', '<rss><note><title>x</title></note></rss>')]);
      expect(result.skipped).toEqual([{ file: 'feed.enex', reason: 'Not an Evernote export' }]);
    });
  });

  describe('Notion', () => {
    const id = (n: number) =>
      String(n)
        .repeat(32)
        .slice(0, 32)
        .replace(/\d/g, (d) => 'abcdef0123'[Number(d)]);

    it('strips the ids, keeps folders as notebooks and turns links between pages into wiki links', async () => {
      const zip = new JSZip();
      zip.file(
        `Plans ${id(1)}.md`,
        `# Plans\n\nSee [Trip](Plans%20${id(1)}/Trip%20${id(2)}.md), [the budget](Plans%20${id(1)}/Budget%20${id(3)}.md) and [a site](https://example.com/x.md).`,
      );
      zip.file(`Plans ${id(1)}/Trip ${id(2)}.md`, `# Trip\n\nBack to [Plans](../Plans%20${id(1)}.md).`);
      zip.file(`Plans ${id(1)}/Budget ${id(3)}.md`, '# Budget\n\n```\n[not a link](Trip%20x.md)\n```');
      zip.file(`Plans ${id(1)}/photo.png`, 'png');
      const result = await service.import(USER, [file('Export.zip', await zip.generateAsync({ type: 'nodebuffer' }))]);

      expect(result).toMatchObject({ imported: 3, notebooksCreated: 1 });
      expect(result.skipped).toEqual([{ file: 'Plans/photo.png', reason: 'No note links to it' }]);
      const created = Object.fromEntries(
        prisma.note.create.mock.calls.map(([call]) => [call.data.title, [call.data.notebookId, call.data.content]]),
      );
      expect(created).toEqual({
        Plans: [null, 'See [[Trip]], [[Budget|the budget]] and [a site](https://example.com/x.md).'],
        Trip: ['nb-1', 'Back to [[Plans]].'],
        Budget: ['nb-1', '```\n[not a link](Trip%20x.md)\n```'],
      });
      expect(prisma.notebook.create).toHaveBeenCalledWith({ data: { userId: USER, parentId: null, name: 'Plans' } });
      expect(links.sync).toHaveBeenCalledWith(prisma, 'note-Trip', 'Back to [[Plans]].');
    });
  });

  it('keeps imported text within the limits of a typed note', async () => {
    const result = await service.import(USER, [
      file('long.md', 'x'.repeat(1_000_001)),
      file(`${'t'.repeat(300)}.md`, 'x'),
    ]);
    expect(result.skipped).toEqual([{ file: 'long.md', reason: 'The note is too long' }]);
    expect(prisma.note.create.mock.calls[0][0].data.title).toHaveLength(200);
  });

  describe('images and PDFs', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    beforeEach(() => prisma.$queryRaw.mockResolvedValue([]));

    it('attaches the files a vault note links to or embeds, and rewrites the links', async () => {
      const zip = new JSZip();
      zip.file(
        'Vault/Trip.md',
        'Day one ![[beach.png]] and ![[Beach.PNG|the beach]].\n\n![The map](../maps/map%20one.png) [Plan](plan.pdf) [site](https://example.com/x.png)\n\n```\n![[beach.png]]\n```',
      );
      zip.file('Vault/attachments/beach.png', png);
      zip.file('maps/map one.png', png);
      zip.file('Vault/plan.pdf', '%PDF-1.4');
      zip.file('Vault/unused.png', png);
      const result = await service.import(USER, [file('vault.zip', await zip.generateAsync({ type: 'nodebuffer' }))]);

      expect(result).toMatchObject({ imported: 1, attachmentsImported: 3 });
      expect(result.skipped).toEqual([{ file: 'Vault/unused.png', reason: 'No note links to it' }]);
      const content: string = prisma.note.create.mock.calls[0][0].data.content;
      const ids = [...content.matchAll(/attachment:([0-9a-f-]{36})/g)].map((match) => match[1]);
      // The same file twice in one note is one attachment.
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(3);
      expect(content).toBe(
        `Day one ![beach.png](attachment:${ids[0]}) and ![the beach](attachment:${ids[0]}).\n\n` +
          `![The map](attachment:${ids[2]}) [Plan](attachment:${ids[3]}) [site](https://example.com/x.png)\n\n` +
          '```\n![[beach.png]]\n```',
      );
      expect(attachments.store.mock.calls.map(([name]) => name)).toEqual([
        'Vault/attachments/beach.png',
        'maps/map one.png',
        'Vault/plan.pdf',
      ]);
      const rows = prisma.attachment.createMany.mock.calls[0][0].data;
      expect(rows.map((row: { noteId: string; userId: string }) => [row.noteId, row.userId])).toEqual([
        ['note-Trip', USER],
        ['note-Trip', USER],
        ['note-Trip', USER],
      ]);
    });

    it('leaves a link as it was when its file is refused, and removes the files past the account limit', async () => {
      attachments.store.mockResolvedValueOnce(null);
      const one = await service.import(USER, [file('a.md', 'See ![x](bad.png)'), file('bad.png', png)]);
      expect(prisma.note.create.mock.calls[0][0].data.content).toBe('See ![x](bad.png)');
      expect(one.skipped).toEqual([
        { file: 'bad.png', reason: 'Not an image or PDF that can be attached, or too large' },
      ]);

      attachments.hasRoom.mockResolvedValueOnce(false);
      const two = await service.import(USER, [file('b.md', 'See ![x](big.png)'), file('big.png', png)]);
      expect(prisma.note.create.mock.calls[1][0].data.content).toBe('See ![x](big.png)');
      expect(two).toMatchObject({ imported: 1, attachmentsImported: 0 });
      expect(two.skipped).toEqual([{ file: 'b.md', reason: 'Its images and PDFs would go past the account limit' }]);
      expect(attachments.removeFiles).toHaveBeenCalledTimes(1);
    });

    it('counts a note with images as there already whichever attachments its links name', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const result = await service.import(USER, [file('a.md', 'See ![x](p.png)'), file('p.png', png)]);
      expect(result).toMatchObject({ imported: 0, duplicates: 1 });
      expect(attachments.store).not.toHaveBeenCalled();
      expect(result.skipped).toEqual([]);
    });
  });
});
