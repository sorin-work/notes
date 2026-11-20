import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Note } from '@prisma/client';
import { Page, PaginationQuery, skipFor } from '../common/pagination';
import { excerpt } from '../common/text';
import { LinksService } from '../links/links.service';
import { findMention, isMentionable, linkMention, normalizeTitle } from '../links/wikilinks';
import { PrismaService } from '../prisma/prisma.service';
import { VersionsService } from '../versions/versions.service';

export interface Mention {
  id: string;
  title: string;
  updatedAt: Date;
  /** The paragraph the title is mentioned in, as plain text. */
  context: string;
}

export interface MentionPage extends Page<Mention> {
  /** True when more notes matched the index than were read, so the list may be missing some. */
  capped: boolean;
}

/** The newest notes the index offers are read and checked, and no more than this. */
export const MAX_CANDIDATES = 200;
/** How many of them are held in memory at a time. A note can be a megabyte. */
const BATCH = 25;

/**
 * Notes that mention another note's title without linking to it, and the
 * "Link" that turns such a mention into a [[link]].
 */
@Injectable()
export class MentionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
    private readonly versions: VersionsService,
  ) {}

  /**
   * The notes of this user, outside the trash, that write the title of
   * `noteId` in plain text and have no link to it. The full-text index names
   * the candidates, newest first. Each one is then read, because the index
   * cannot tell a mention from one inside code or a link, and matches word
   * stems where a title has to match as written.
   */
  async list(userId: string, noteId: string, page: PaginationQuery): Promise<MentionPage> {
    const target = await this.findNote(userId, noteId);
    const none = { items: [], total: 0, page: page.page, pageSize: page.pageSize, capped: false };
    // Nothing is linked to a note in the trash. Very short titles are mostly just words,
    // and a title that cannot be written as a [[link]] has no mention that could be linked.
    if (target.deletedAt || !isMentionable(target.title)) return none;

    const candidates = await this.candidateIds(userId, target, MAX_CANDIDATES + 1);
    const capped = candidates.length > MAX_CANDIDATES;
    const mentions: Mention[] = [];
    for (let from = 0; from < Math.min(candidates.length, MAX_CANDIDATES); from += BATCH) {
      const ids = candidates.slice(from, Math.min(from + BATCH, MAX_CANDIDATES));
      const notes = await this.prisma.note.findMany({
        where: { id: { in: ids }, userId, deletedAt: null },
        select: { id: true, title: true, content: true, updatedAt: true },
      });
      // findMany does not promise the order of the ids it was given.
      const byId = new Map(notes.map((note) => [note.id, note]));
      for (const id of ids) {
        const note = byId.get(id);
        const mention = note && findMention(note.content, target.title);
        if (note && mention) {
          mentions.push({
            id: note.id,
            title: note.title,
            updatedAt: note.updatedAt,
            context: paragraphAround(note.content, mention.start),
          });
        }
      }
    }

    const start = skipFor(page);
    return {
      items: mentions.slice(start, start + page.pageSize),
      total: mentions.length,
      page: page.page,
      pageSize: page.pageSize,
      capped,
    };
  }

  /**
   * Wraps the first unlinked mention of `noteId`'s title in the note
   * `sourceId` in [[ ]]. The text that is replaced is saved as a version
   * first, so the change can be undone from the history of that note. Its
   * "last edited" time stays as it was: the app made this change, and the
   * note should not jump to the top of every list for it.
   */
  async link(userId: string, noteId: string, sourceId: string): Promise<void> {
    const target = await this.findNote(userId, noteId);
    if (target.deletedAt) {
      throw new ConflictException('Restore the note from the trash before linking to it');
    }

    await this.prisma.$transaction(async (tx) => {
      // The row is locked so that the text read here is the text that gets rewritten.
      await tx.$queryRaw`SELECT id FROM notes WHERE id = ${sourceId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
      const source = await tx.note.findFirst({ where: { id: sourceId, userId, deletedAt: null } });
      if (!source || source.id === target.id) {
        throw new NotFoundException('Note not found');
      }
      const linked = linkMention(source.content, target.title);
      if (linked === null) {
        throw new ConflictException(`That note no longer mentions "${target.title}" without a link`);
      }
      await this.versions.snapshot(tx, source);
      await tx.note.update({ where: { id: source.id }, data: { content: linked } });
      await this.links.sync(tx, source.id, linked);
    });
  }

  /** Ids of the notes whose indexed words contain the title as a phrase and that do not link to it yet. */
  private async candidateIds(userId: string, target: Note, limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT n.id
      FROM notes n
      WHERE n.user_id = ${userId}::uuid AND n.deleted_at IS NULL AND n.id <> ${target.id}::uuid
        AND n.search_vector @@ phraseto_tsquery('english', ${target.title})
        AND NOT EXISTS (
          SELECT 1 FROM note_links l
          WHERE l.source_id = n.id AND l.target_key = ${normalizeTitle(target.title)})
      ORDER BY n.updated_at DESC, n.id
      LIMIT ${limit}`;
    return rows.map((row) => row.id);
  }

  private async findNote(userId: string, noteId: string): Promise<Note> {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, userId } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }
}

/** The paragraph that position `at` of a note falls in, as plain text. */
export function paragraphAround(content: string, at: number): string {
  let start = 0;
  for (const gap of content.matchAll(/\r?\n\s*\r?\n/g)) {
    if (gap.index >= at) return excerpt(content.slice(start, gap.index), 200);
    start = gap.index + gap[0].length;
  }
  return excerpt(content.slice(start), 200);
}
