import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { excerpt } from '../common/text';
import { PrismaService } from '../prisma/prisma.service';
import { extractWikiLinks, normalizeTitle } from './wikilinks';

export interface Backlink {
  id: string;
  title: string;
  updatedAt: Date;
  /** The paragraph around the link in the linking note. */
  context: string;
}

type RawQueries = Pick<Prisma.TransactionClient, '$queryRaw'>;

export interface OutgoingLink {
  title: string;
  /** The note the link resolves to, or null when no note has that title. */
  noteId: string | null;
}

export interface GraphNode {
  id: string;
  title: string;
}

/** A link from one note in the graph to another, each pair once in each direction at most. */
export interface GraphEdge {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** How many notes match the filters. More than there are nodes when the limit cut the graph short. */
  total: number;
}

/** A drawing of more notes than this is a ball of wool. The notes edited last are kept. */
export const MAX_GRAPH_NODES = 300;

/**
 * How a title is turned into the key that links are matched by, in SQL. It
 * has to give what normalizeTitle gives, and it is the expression resolveKeys
 * uses. The column name is one of two fixed strings, never input.
 */
const titleKey = (column: 'title' | 'n.title') =>
  Prisma.raw(`lower(regexp_replace(btrim(${column}), '\\s+', ' ', 'g'))`);

@Injectable()
export class LinksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rewrites the stored links of a note from its content. */
  async sync(tx: Prisma.TransactionClient, noteId: string, content: string): Promise<void> {
    const links = extractWikiLinks(content);
    await tx.noteLink.deleteMany({ where: { sourceId: noteId } });
    if (links.length > 0) {
      await tx.noteLink.createMany({
        data: links.map((link) => ({
          sourceId: noteId,
          targetTitle: link.title,
          targetKey: normalizeTitle(link.title),
        })),
      });
    }
  }

  /** Notes outside the trash whose [[links]] point at this note's title. */
  async backlinks(userId: string, noteId: string): Promise<Backlink[]> {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, userId }, select: { title: true } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    const key = normalizeTitle(note.title);
    const sources = await this.prisma.note.findMany({
      where: {
        userId,
        deletedAt: null,
        id: { not: noteId },
        outgoingLinks: { some: { targetKey: key } },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true, content: true },
    });
    return sources.map((source) => ({
      id: source.id,
      title: source.title,
      updatedAt: source.updatedAt,
      context: linkContext(source.content, key),
    }));
  }

  /**
   * The notes outside the trash with no links in or out: nothing in their own
   * text links anywhere, and no other note links to their title.
   */
  async orphanIds(userId: string): Promise<string[]> {
    // Titles are compared with link keys the way resolveKeys compares them.
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT n.id
      FROM notes n
      WHERE n.user_id = ${userId}::uuid AND n.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM note_links own WHERE own.source_id = n.id)
        AND NOT EXISTS (
          SELECT 1
          FROM note_links incoming JOIN notes source ON source.id = incoming.source_id
          WHERE source.user_id = ${userId}::uuid AND source.deleted_at IS NULL AND source.id <> n.id
            AND incoming.target_key = ${titleKey('n.title')})`;
    return rows.map((row) => row.id);
  }

  /**
   * Notes outside the trash as nodes, and the links between them as edges,
   * in one query. A link leads to the note its title resolves to: the most
   * recently edited one with that title, as everywhere else. Links to notes
   * outside the graph, to missing notes and from a note to itself are left out.
   *
   * `notebookIds` narrows the graph to those notebooks, or with "none" to
   * the notes outside any notebook. `tag` narrows it to the notes with that tag.
   */
  async graph(userId: string, filter: { notebookIds?: string[] | 'none'; tag?: string } = {}): Promise<Graph> {
    const conditions = [Prisma.sql`n.user_id = ${userId}::uuid`, Prisma.sql`n.deleted_at IS NULL`];
    if (filter.notebookIds === 'none') {
      conditions.push(Prisma.sql`n.notebook_id IS NULL`);
    } else if (filter.notebookIds) {
      const ids = filter.notebookIds.map((id) => Prisma.sql`${id}::uuid`);
      conditions.push(Prisma.sql`n.notebook_id IN (${Prisma.join(ids)})`);
    }
    if (filter.tag) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = n.id AND t.user_id = ${userId}::uuid AND t.name = ${filter.tag})`);
    }

    const rows = await this.prisma.$queryRaw<{ total: bigint; nodes: GraphNode[]; edges: GraphEdge[] }[]>`
      WITH matching AS (
        SELECT n.id, n.title, n.updated_at
        FROM notes n
        WHERE ${Prisma.join(conditions, ' AND ')}
      ),
      picked AS (
        SELECT * FROM matching ORDER BY updated_at DESC, id LIMIT ${MAX_GRAPH_NODES}
      ),
      titled AS (
        SELECT DISTINCT ON (key) id, key
        FROM (
          SELECT id, ${titleKey('title')} AS key, updated_at
          FROM notes
          WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
        ) named
        ORDER BY key, updated_at DESC
      ),
      linked AS (
        SELECT DISTINCT link.source_id AS source, titled.id AS target
        FROM note_links link
        JOIN picked origin ON origin.id = link.source_id
        JOIN titled ON titled.key = link.target_key
        JOIN picked destination ON destination.id = titled.id
        WHERE link.source_id <> titled.id
      )
      SELECT
        (SELECT count(*) FROM matching) AS total,
        (SELECT coalesce(json_agg(json_build_object('id', id, 'title', title) ORDER BY updated_at DESC, id), '[]'::json)
           FROM picked) AS nodes,
        (SELECT coalesce(json_agg(json_build_object('source', source, 'target', target) ORDER BY source, target), '[]'::json)
           FROM linked) AS edges`;
    const row = rows[0];
    return { nodes: row?.nodes ?? [], edges: row?.edges ?? [], total: Number(row?.total ?? 0) };
  }

  /** The links written in a note, with the note each one currently resolves to. */
  async outgoing(userId: string, noteId: string): Promise<OutgoingLink[]> {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, userId },
      select: { outgoingLinks: { select: { targetTitle: true, targetKey: true } } },
    });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    const targets = await this.resolveKeys(
      userId,
      note.outgoingLinks.map((link) => link.targetKey),
    );
    return note.outgoingLinks.map((link) => ({ title: link.targetTitle, noteId: targets.get(link.targetKey) ?? null }));
  }

  /**
   * Whether a note outside the trash has this title, leaving the note
   * `except` out of it. Links to a title lead somewhere only then. Pass the
   * transaction as `db` to ask from inside one.
   */
  async titleTaken(
    userId: string,
    title: string,
    { except = null, db = this.prisma }: { except?: string | null; db?: RawQueries } = {},
  ): Promise<boolean> {
    // The same comparison as in resolveKeys below.
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM notes
      WHERE user_id = ${userId}::uuid
        AND deleted_at IS NULL
        AND lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) = ${normalizeTitle(title)}
        AND (${except}::uuid IS NULL OR id <> ${except}::uuid)
      LIMIT 1`;
    return rows.length > 0;
  }

  /** The most recently edited note outside the trash with this title. */
  async resolve(userId: string, title: string): Promise<{ id: string; title: string }> {
    const target = (await this.resolveKeys(userId, [normalizeTitle(title)])).get(normalizeTitle(title));
    if (!target) {
      throw new NotFoundException(`No note is called "${title.trim()}"`);
    }
    const note = await this.prisma.note.findUniqueOrThrow({ where: { id: target }, select: { id: true, title: true } });
    return note;
  }

  private async resolveKeys(userId: string, keys: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (keys.length === 0) return result;
    // Titles are matched case-insensitively. Prisma cannot express
    // lower(title) IN (...), so this compares in SQL directly.
    const rows = await this.prisma.$queryRaw<{ id: string; key: string }[]>`
      SELECT DISTINCT ON (key) id, key
      FROM (
        SELECT id, lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) AS key, updated_at
        FROM notes
        WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
      ) titled
      WHERE key = ANY(${keys})
      ORDER BY key, updated_at DESC`;
    for (const row of rows) result.set(row.key, row.id);
    return result;
  }
}

/** The paragraph containing the first link to `key`, as plain text. */
export function linkContext(content: string, key: string): string {
  const paragraphs = content.split(/\r?\n\s*\r?\n/);
  const paragraph =
    paragraphs.find((p) => extractWikiLinks(p).some((link) => normalizeTitle(link.title) === key)) ?? '';
  return excerpt(paragraph, 200);
}
