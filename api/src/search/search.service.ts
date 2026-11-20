import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, skipFor } from '../common/pagination';
import { cleanSnippet, excerpt } from '../common/text';
import { NotebooksService } from '../notebooks/notebooks.service';
import type { NoteFilterQuery } from '../notes/dto/note.dto';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTagName } from '../tags/tag-name';
import { HIGHLIGHT_END, HIGHLIGHT_START, parseSearch } from './search-query';

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
  content: string;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly notebooks: NotebooksService,
  ) {}

  /** Notes matching `q`, narrowed to a notebook or a tag when `options` names one. */
  async search(userId: string, q: string, options: NoteFilterQuery): Promise<Page<SearchHit>> {
    const terms = parseSearch(q);
    if (!terms) {
      return { items: [], total: 0, page: options.page, pageSize: options.pageSize };
    }

    // Everything that comes from the request goes in as a bound parameter, never as SQL text.
    // The loose words are a tsquery built from letters and digits only. A quoted phrase is
    // handed over as it was typed, for phraseto_tsquery to split the way the notes were split.
    const queries = terms.phrases.map((phrase) => Prisma.sql`phraseto_tsquery('english', ${phrase})`);
    if (terms.prefix) queries.unshift(Prisma.sql`to_tsquery('english', ${terms.prefix})`);

    const conditions = [
      Prisma.sql`n.user_id = ${userId}::uuid`,
      Prisma.sql`n.deleted_at IS NULL`,
      Prisma.sql`n.search_vector @@ query`,
    ];
    if (options.notebookId === 'none') {
      conditions.push(Prisma.sql`n.notebook_id IS NULL`);
    } else if (options.notebookId) {
      // A top-level notebook covers the notebooks inside it too, as in the note list.
      const ids = await this.notebooks.idsWithChildren(userId, options.notebookId);
      conditions.push(Prisma.sql`n.notebook_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`);
    }
    if (options.tag) {
      const name = normalizeTagName(options.tag) ?? options.tag;
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = n.id AND t.user_id = ${userId}::uuid AND t.name = ${name})`);
    }

    const match = Prisma.sql`
      FROM notes n, (SELECT ${Prisma.join(queries, ' && ')} AS query) search
      WHERE ${Prisma.join(conditions, ' AND ')}`;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<Row[]>`
        SELECT n.id, n.title, n.content, n.notebook_id, n.pinned, n.favorite, n.updated_at,
               ts_rank(n.search_vector, query) AS rank,
               ts_headline('english', n.content, query, ${HEADLINE_OPTIONS}) AS snippet,
               (SELECT array_agg(t.name ORDER BY t.name)
                  FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
                 WHERE nt.note_id = n.id) AS tags
        ${match}
        ORDER BY rank DESC, n.updated_at DESC, n.id
        LIMIT ${options.pageSize} OFFSET ${skipFor(options)}`,
      this.prisma.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count ${match}`,
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        // A title-only match has no highlighted words in the body.
        snippet: row.snippet.includes(HIGHLIGHT_START) ? cleanSnippet(row.snippet) : excerpt(row.content),
        notebookId: row.notebook_id,
        tags: row.tags ?? [],
        pinned: row.pinned,
        favorite: row.favorite,
        updatedAt: row.updated_at,
        rank: Number(row.rank),
      })),
      total: Number(counted[0]?.count ?? 0),
      page: options.page,
      pageSize: options.pageSize,
    };
  }
}
