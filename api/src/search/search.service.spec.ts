import { PaginationQuery } from '../common/pagination';
import { NotebooksService } from '../notebooks/notebooks.service';
import { NoteFilterQuery } from '../notes/dto/note.dto';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { SearchService } from './search.service';

/** The FROM and WHERE part that the page query and the count share. */
function matchClause(prisma: PrismaMock): { sql: string; values: unknown[] } {
  const args = prisma.$queryRaw.mock.calls[0] as { sql?: string; values?: unknown[] }[];
  return args.find((arg) => typeof arg?.sql === 'string') as { sql: string; values: unknown[] };
}

describe('SearchService', () => {
  let prisma: PrismaMock;
  let notebooks: jest.Mocked<Pick<NotebooksService, 'idsWithChildren'>>;
  let service: SearchService;
  const page = Object.assign(new PaginationQuery(), { page: 1, pageSize: 20 });

  beforeEach(() => {
    prisma = createPrismaMock();
    notebooks = { idsWithChildren: jest.fn() };
    service = new SearchService(asPrismaService(prisma), notebooks as unknown as NotebooksService);
  });

  it('does not query the database for an empty search', async () => {
    await expect(service.search('user-1', '%%', page)).resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('maps rows to hits with highlighted snippets', async () => {
    const updatedAt = new Date();
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          id: 'n1',
          title: 'Atlas',
          content: 'The weekly sync',
          snippet: 'The \u0002weekly\u0003 | sync',
          notebook_id: null,
          tags: ['atlas'],
          pinned: false,
          favorite: true,
          updated_at: updatedAt,
          rank: 0.6,
        },
        {
          id: 'n2',
          title: 'Weekly review',
          content: '# Weekly review\n\nFriday afternoon',
          snippet: 'Weekly review Friday afternoon',
          notebook_id: 'nb',
          tags: null,
          pinned: false,
          favorite: false,
          updated_at: updatedAt,
          rank: 0.4,
        },
      ])
      .mockResolvedValueOnce([{ count: BigInt(2) }]);

    const result = await service.search('user-1', 'week', page);

    expect(result.total).toBe(2);
    expect(result.items[0]).toMatchObject({
      id: 'n1',
      snippet: 'The \u0002weekly\u0003 sync',
      tags: ['atlas'],
      rank: 0.6,
    });
    // Title-only matches fall back to the start of the note.
    expect(result.items[1]).toMatchObject({ snippet: 'Friday afternoon', tags: [] });
  });

  it('passes the notebook and tag filters as parameters, never as SQL text', async () => {
    notebooks.idsWithChildren.mockResolvedValue(['nb-1', 'nb-2']);
    prisma.$queryRaw.mockResolvedValue([]);
    const filters = Object.assign(new NoteFilterQuery(), { notebookId: 'nb-1', tag: "x'); DROP TABLE notes; --" });

    await expect(service.search('user-1', '"weekly sync"', filters)).resolves.toMatchObject({ items: [], total: 0 });

    expect(notebooks.idsWithChildren).toHaveBeenCalledWith('user-1', 'nb-1');
    const match = matchClause(prisma);
    expect(match.values).toEqual(['(weekly <-> sync)', 'user-1', 'nb-1', 'nb-2', 'user-1', "x');-drop-table-notes;"]);
    expect(match.sql).toContain('n.notebook_id IN (?::uuid,?::uuid)');
    expect(match.sql).not.toMatch(/drop|weekly|nb-1/i);
  });

  it('looks for notes outside any notebook when asked for "none"', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    await service.search('user-1', 'week', Object.assign(new NoteFilterQuery(), { notebookId: 'none' }));

    expect(notebooks.idsWithChildren).not.toHaveBeenCalled();
    expect(matchClause(prisma).sql).toContain('n.notebook_id IS NULL');
  });
});
