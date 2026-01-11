import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, PaginationQuery, skipFor } from '../common/pagination';
import { PrismaService } from '../prisma/prisma.service';
import { HIGHLIGHT_END, HIGHLIGHT_START, toPrefixQuery } from './search-query';

export interface SearchHit {
  id: string;
  title: string;
  /**
   * Matching passages from the note. Matched words are wrapped in \u0002 and
   * \u0003 so the client can highlight them without trusting HTML.
   */
  snippet: string;
  notebookId: string | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  updatedAt: Date;
  rank: number;
}

interface Row {
  id: string;
  title: string;
  snippet: string;
  notebook_id: string | null;
  tags: string[] | null;
  pinned: boolean;
  favorite: boolean;
  updated_at: Date;
  rank: number;
}

const HEADLINE_OPTIONS = `StartSel=${HIGHLIGHT_START}, StopSel=${HIGHLIGHT_END}, MaxWords=24, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "`;

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(userId: string, q: string, page: PaginationQuery): Promise<Page<SearchHit>> {
    const tsquery = toPrefixQuery(q);
    if (!tsquery) {
      return { items: [], total: 0, page: page.page, pageSize: page.pageSize };
    }

    const match = Prisma.sql`
      FROM notes n, to_tsquery('english', ${tsquery}) query
      WHERE n.user_id = ${userId}::uuid
        AND n.deleted_at IS NULL
        AND n.search_vector @@ query`;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT n.id, n.title, n.notebook_id, n.pinned, n.favorite, n.updated_at,
               ts_rank(n.search_vector, query) AS rank,
               ts_headline('english', n.content, query, ${HEADLINE_OPTIONS}) AS snippet,
               (SELECT array_agg(t.name ORDER BY t.name)
                  FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
                 WHERE nt.note_id = n.id) AS tags
        ${match}
        ORDER BY rank DESC, n.updated_at DESC
        LIMIT ${page.pageSize} OFFSET ${skipFor(page)}`,
      this.prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count ${match}`,
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        snippet: row.snippet,
        notebookId: row.notebook_id,
        tags: row.tags ?? [],
        pinned: row.pinned,
        favorite: row.favorite,
        updatedAt: row.updated_at,
        rank: Number(row.rank),
      })),
      total: Number(counted[0]?.count ?? 0),
      page: page.page,
      pageSize: page.pageSize,
    };
  }
}
