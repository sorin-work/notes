import JSZip from 'jszip';
import type { AttachmentsService } from '../attachments/attachments.service';
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
  let attachments: { read: jest.Mock };

  beforeEach(() => {
    prisma = createPrismaMock();
    attachments = { read: jest.fn((id: string) => Promise.resolve(Buffer.from(`bytes of ${id}`))) };
    prisma.attachment.findMany.mockResolvedValue([]);
    service = new ExportService(asPrismaService(prisma), attachments as unknown as AttachmentsService);
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

  it('puts the files of attachments in the zip, and links the notes to them by a relative path', async () => {
    const id = '6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e';
    const other = '00000000-0000-4000-8000-000000000001';
    prisma.attachment.findMany.mockResolvedValue([{ id, fileName: 'beach photo?.png' }]);
    prisma.note.findMany.mockResolvedValue([
      note(
        'Trip',
        { name: 'Travel', parent: { name: 'Life' } },
        {
          content: `![beach](attachment:${id}) and ![gone](attachment:${other})`,
        },
      ),
      note('Top', null, { content: `![again](attachment:${id})` }),
    ]);

    const zip = await JSZip.loadAsync(await service.exportAll('user-1'));

    expect(await zip.file(`attachments/${id}/beach photo .png`)?.async('string')).toBe(`bytes of ${id}`);
    expect(await zip.file('Life/Travel/Trip.md')?.async('string')).toContain(
      `![beach](../../attachments/${id}/beach%20photo%20.png) and ![gone](attachment:${other})`,
    );
    expect(await zip.file('Top.md')?.async('string')).toContain(`![again](attachments/${id}/beach%20photo%20.png)`);
    // The owner's own files of notes outside the trash, and nothing else.
    expect(prisma.attachment.findMany.mock.calls[0][0].where).toEqual({
      userId: 'user-1',
      note: { userId: 'user-1', deletedAt: null },
    });
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
