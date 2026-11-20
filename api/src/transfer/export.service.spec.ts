import JSZip from 'jszip';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { ExportService, toMarkdownFile } from './export.service';

const created = new Date('2026-01-05T10:00:00Z');
const updated = new Date('2026-02-01T18:30:00Z');

function note(title: string, notebook: unknown = null, overrides: Record<string, unknown> = {}) {
  return {
    title,
    content: `Body of ${title}`,
    pinned: false,
    favorite: false,
    createdAt: created,
    updatedAt: updated,
    tags: [],
    notebook,
    ...overrides,
  };
}

describe('toMarkdownFile', () => {
  it('puts title, tags, flags and dates in front matter', () => {
    const markdown = toMarkdownFile(
      note('Plan', null, {
        pinned: true,
        isTemplate: true,
        tags: [{ tag: { name: 'work' } }, { tag: { name: 'q1' } }],
      }),
    );
    expect(markdown).toBe(
      [
        '---',
        'title: Plan',
        'tags: [work, q1]',
        'pinned: true',
        'template: true',
        'created: "2026-01-05T10:00:00.000Z"',
        'updated: "2026-02-01T18:30:00.000Z"',
        '---',
        'Body of Plan',
        '',
      ].join('\n'),
    );
  });
});

describe('ExportService', () => {
  let prisma: PrismaMock;
  let service: ExportService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new ExportService(asPrismaService(prisma));
  });

  const files = async () =>
    Object.values((await JSZip.loadAsync(await service.exportAll('user-1'))).files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .sort();
  const nb = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId });

  it('exports notes into folders nested the way their notebooks are', async () => {
    prisma.notebook.findMany.mockResolvedValue([
      nb('w', 'Work'),
      nb('m', 'Meetings', 'w'),
      nb('y', '2026', 'm'),
      nb('q', 'Q1', 'y'),
      nb('e', 'Empty'),
    ]);
    prisma.note.findMany.mockResolvedValue([
      note('Inbox note'),
      note('Plan', null, { notebookId: 'w' }),
      note('Plan', null, { notebookId: 'w' }),
      note('Sync: Tuesday', null, { notebookId: 'm' }),
      note('Kickoff', null, { notebookId: 'q' }),
    ]);

    expect(await files()).toEqual([
      'Inbox note.md',
      'Work/Meetings/2026/Q1/Kickoff.md',
      'Work/Meetings/Sync Tuesday.md',
      'Work/Plan (2).md',
      'Work/Plan.md',
    ]);
    expect(prisma.note.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1', deletedAt: null });
    expect(prisma.notebook.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1' });
  });

  it('reads the notebooks and the notes in one repeatable-read snapshot', async () => {
    prisma.notebook.findMany.mockResolvedValue([]);
    prisma.note.findMany.mockResolvedValue([note('Plan')]);
    await files();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' });
  });

  it('keeps apart notebooks whose names come out the same, and a notebook from a note file of its name', async () => {
    prisma.notebook.findMany.mockResolvedValue([
      // Fine as notebook names side by side, the same once the slash is gone.
      nb('a', 'Q1/Q2'),
      nb('b', 'Q1 Q2'),
      // The same name is fine in different places.
      nb('c', 'Plans', 'a'),
      nb('d', 'Plans', 'b'),
      // A folder called "Notes.md" next to a note called "Notes".
      nb('e', 'Notes.md'),
    ]);
    prisma.note.findMany.mockResolvedValue([
      note('One', null, { notebookId: 'c' }),
      note('Two', null, { notebookId: 'd' }),
      note('Inside', null, { notebookId: 'e' }),
      note('Notes'),
      note('Q1 Q2'),
    ]);

    expect(await files()).toEqual([
      'Notes (2).md',
      'Notes.md/Inside.md',
      'Q1 Q2 (2)/Plans/Two.md',
      'Q1 Q2.md',
      'Q1 Q2/Plans/One.md',
    ]);
  });

  it('puts a note at the top when its notebook cannot be found, and survives a loop in the data', async () => {
    prisma.notebook.findMany.mockResolvedValue([nb('x', 'X', 'y'), nb('y', 'Y', 'x')]);
    prisma.note.findMany.mockResolvedValue([
      note('Lost', null, { notebookId: 'gone' }),
      note('Looped', null, { notebookId: 'x' }),
    ]);
    const names = await files();
    expect(names).toContain('Lost.md');
    expect(names.find((name) => name.endsWith('Looped.md'))).toMatch(/^Y\/X\/Looped\.md$|^X\/Looped\.md$/);
  });

  it('exports a single note with a safe file name', async () => {
    prisma.note.findFirst.mockResolvedValue(note('Q1/Q2 plan'));
    const result = await service.exportNote('user-1', 'n1');
    expect(result.filename).toBe('Q1 Q2 plan.md');
    expect(result.markdown).toContain('Body of Q1/Q2 plan');
  });

  it('404s for a note of another user', async () => {
    prisma.note.findFirst.mockResolvedValue(null);
    await expect(service.exportNote('user-1', 'n1')).rejects.toThrow('Note not found');
  });
});
