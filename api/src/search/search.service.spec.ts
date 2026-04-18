import { PaginationQuery } from '../common/pagination';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { SearchService } from './search.service';

describe('SearchService', () => {
  let prisma: PrismaMock;
  let service: SearchService;
  const page = Object.assign(new PaginationQuery(), { page: 1, pageSize: 20 });

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new SearchService(asPrismaService(prisma));
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
});
