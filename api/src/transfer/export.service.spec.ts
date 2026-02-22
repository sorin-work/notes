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
      note('Plan', null, { pinned: true, tags: [{ tag: { name: 'work' } }, { tag: { name: 'q1' } }] }),
    );
    expect(markdown).toBe(
      [
        '---',
        'title: Plan',
        'tags: [work, q1]',
        'pinned: true',
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

  it('exports notes into folders named after their notebooks', async () => {
    const work = { name: 'Work', parent: null };
    const meetings = { name: 'Meetings', parent: { name: 'Work' } };
    prisma.note.findMany.mockResolvedValue([
      note('Inbox note'),
      note('Plan', work),
      note('Plan', work),
      note('Sync: Tuesday', meetings),
    ]);

    const zip = await JSZip.loadAsync(await service.exportAll('user-1'));
    const files = Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name)
      .sort();

    expect(files).toEqual(['Inbox note.md', 'Work/Meetings/Sync Tuesday.md', 'Work/Plan (2).md', 'Work/Plan.md']);
    expect(await zip.file('Work/Plan.md')?.async('string')).toContain('title: Plan');
    expect(prisma.note.findMany.mock.calls[0][0].where).toEqual({ userId: 'user-1', deletedAt: null });
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
