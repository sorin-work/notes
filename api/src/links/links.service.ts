import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { excerpt } from '../common/text';
import { workingNoteSql, workingNotes } from '../notes/note-scope';
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
  /**
   * How many links the note has to and from other notes outside the trash,
   * wherever those are. More than the edges it has in the graph when some of
   * them lead to notes that the filters or the limit left out.
   */
  links: number;
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
 * has to give what normalizeTitle gives. resolveKeys, the orphans and the
 * graph all compare titles through it, and titleTaken spells the same
 * expression out. The column name is one of two fixed strings, never input.
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

  /** The notes whose [[links]] point at this note's title. A template that links here is not one of them. */
  async backlinks(userId: string, noteId: string): Promise<Backlink[]> {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, userId }, select: { title: true } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    const key = normalizeTitle(note.title);
    const sources = await this.prisma.note.findMany({
      where: {
        ...workingNotes(userId),
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
   * The working notes (outside the trash, not templates) with no links in
   * or out. A link counts, in either direction, when it leads from one
   * working note to another: the note its title resolves to, as in
   * resolveKeys. A link to a title no note has, to a note in the trash or a
   * template, or from a note to itself connects nothing.
   */
  async orphanIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH named AS (
        SELECT id, ${titleKey('title')} AS key, updated_at
        FROM notes
        WHERE user_id = ${userId}::uuid AND ${workingNoteSql('notes')}
      ),
      resolved AS (
        SELECT DISTINCT ON (key) id, key FROM named ORDER BY key, updated_at DESC
      ),
      connected AS (
        SELECT link.source_id AS source, resolved.id AS target
        FROM note_links link
        JOIN named origin ON origin.id = link.source_id
        JOIN resolved ON resolved.key = link.target_key
        WHERE resolved.id <> link.source_id
      )
      SELECT named.id
      FROM named
      WHERE NOT EXISTS (
        SELECT 1 FROM connected WHERE connected.source = named.id OR connected.target = named.id)`;
    return rows.map((row) => row.id);
  }

  /**
   * Working notes (outside the trash, not templates) as nodes, and the links
   * between them as edges, in one query. A link leads to the note its title
   * resolves to: the most recently edited one with that title, as everywhere
   * else. Links to notes outside the graph, to missing notes, to templates
   * and from a note to itself are left out of the edges. Each node says how
   * many links it has in all, so that a note whose links all lead outside the
   * graph is not taken for one without.
   *
   * `notebookIds` narrows the graph to those notebooks, or with "none" to
   * the notes outside any notebook. `tag` narrows it to the notes with that tag.
   */
  async graph(userId: string, filter: { notebookIds?: string[] | 'none'; tag?: string } = {}): Promise<Graph> {
    const conditions = [Prisma.sql`n.user_id = ${userId}::uuid`, workingNoteSql('n')];
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
          WHERE user_id = ${userId}::uuid AND ${workingNoteSql('notes')}
        ) named
        ORDER BY key, updated_at DESC
      ),
      connected AS (
        SELECT DISTINCT link.source_id AS source, titled.id AS target
        FROM note_links link
        JOIN notes n ON n.id = link.source_id
        JOIN titled ON titled.key = link.target_key
        WHERE n.user_id = ${userId}::uuid AND ${workingNoteSql('n')} AND link.source_id <> titled.id
      ),
      linked AS (
        SELECT connected.source, connected.target
        FROM connected
        JOIN picked origin ON origin.id = connected.source
        JOIN picked destination ON destination.id = connected.target
      )
      SELECT
        (SELECT count(*) FROM matching) AS total,
        (SELECT coalesce(json_agg(json_build_object(
                  'id', id,
                  'title', title,
                  'links', (SELECT count(*) FROM connected WHERE connected.source = picked.id OR connected.target = picked.id)
                ) ORDER BY updated_at DESC, id), '[]'::json)
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

  /**
   * The note outside the trash with this title. A note goes before a
   * template of the same title, and among those left the most recently
   * edited one wins.
   */
  async resolve(userId: string, title: string): Promise<{ id: string; title: string }> {
    const target = (await this.resolveKeys(userId, [normalizeTitle(title)])).get(normalizeTitle(title));
    if (!target) {
      throw new NotFoundException(`No note is called "${title.trim()}"`);
    }
    const note = await this.prisma.note.findUniqueOrThrow({ where: { id: target }, select: { id: true, title: true } });
    return note;
  }

  /**
   * For each normalised title that some note outside the trash has, the id
   * of that note: the most recently edited one when several share a title.
   *
   * With `among`, only the notes in those notebooks or with those ids are
   * looked at, so that a note outside them cannot win over one inside.
   */
  async resolveKeys(
    userId: string,
    keys: string[],
    among?: { notebookIds: string[] } | { noteIds: string[] },
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (keys.length === 0) return result;
    let within = Prisma.empty;
    if (among) {
      const ids = 'notebookIds' in among ? among.notebookIds : among.noteIds;
      if (ids.length === 0) return result;
      // A shared notebook shows its readers its notes, not its templates.
      within =
        'notebookIds' in among
          ? Prisma.sql`AND notebook_id = ANY(${ids}::uuid[]) AND is_template = false`
          : Prisma.sql`AND id = ANY(${ids}::uuid[])`;
    }
    // Titles are matched case-insensitively. Prisma cannot express
    // lower(title) IN (...), so this compares in SQL directly.
    const rows = await this.prisma.$queryRaw<{ id: string; key: string }[]>`
      SELECT DISTINCT ON (key) id, key
      FROM (
        SELECT id, ${titleKey('title')} AS key, is_template, updated_at
        FROM notes
        WHERE user_id = ${userId}::uuid AND deleted_at IS NULL ${within}
      ) titled
      WHERE key = ANY(${keys})
      ORDER BY key, is_template ASC, updated_at DESC`;
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
