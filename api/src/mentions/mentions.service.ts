import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { type Note, Prisma } from '@prisma/client';
import { Page, PaginationQuery, skipFor } from '../common/pagination';
import { LinksService } from '../links/links.service';
import { ParsePool } from '../links/parse-pool';
import type { ParsedNote } from '../links/prose';
import { isMentionable, mayMention, Mention as Place, normalizeTitle } from '../links/wikilinks';
import { MAX_CONTENT_LENGTH } from '../notes/dto/note.dto';
import { workingNoteSql, workingNotes } from '../notes/note-scope';
import { writeNoteText } from '../notes/note-text';
import { DEFAULT_TITLE } from '../notes/notes.service';
import { PrismaService } from '../prisma/prisma.service';
import { VersionsService } from '../versions/versions.service';

export interface Mention {
  id: string;
  title: string;
  updatedAt: Date;
  /** The line the mention is in, cut to a readable length: what stands before the mention, the mention, what follows. */
  before: string;
  match: string;
  after: string;
  /** Where that mention starts in the note's text. */
  offset: number;
  /** The revision of the note the mention was found in. "Link" sends it back with the offset and the match. */
  version: number;
}

export interface MentionPage extends Page<Mention> {
  /** True when more notes matched the index than were read, so the list may be missing some. */
  capped: boolean;
}

/** The newest notes the index offers are read and checked, and no more than this. */
export const MAX_CANDIDATES = 200;
/**
 * How much text one request parses in all, in characters, and for how long.
 * The parser runs in worker threads (ParsePool), so other requests are not
 * held up, but one list should still not keep both workers busy for long.
 * A note that does not write the title is passed over without being parsed,
 * and does not count. When either budget is spent the rest is left out and
 * the list says it is capped.
 */
export const MAX_PARSED_LENGTH = 1_000_000;
export const MAX_PARSE_MS = 1_000;
/** How many mention requests of one user run at a time. More answer 429. */
export const MAX_REQUESTS_PER_USER = 2;
/**
 * How much memory the cache of parsed notes may take, and the cache of
 * answers ("this note mentions that title there"), by an estimate of the
 * heap their entries use. One app holds one of each.
 */
const CACHED_TREE_BYTES = 64 * 1024 * 1024;
const CACHED_ANSWER_BYTES = 4 * 1024 * 1024;

/** What mentionIn finds. "unavailable" and "busy" come from the pool: no worker could take the note in time. */
type Found = (Place & { linked: string }) | null | 'unparseable' | 'unavailable' | 'busy';

/** An estimate of the heap a parsed note takes: objects, their fields and the strings in them. */
function treeSize(parsed: ParsedNote | null): number {
  if (!parsed) return 64;
  const strings = (list: string[]) => list.reduce((sum, text) => sum + 2 * text.length + 32, 0);
  return (
    256 + parsed.prose.length * 48 + strings(parsed.verbatim) + strings(parsed.formatting) + strings(parsed.labels)
  );
}

/** An estimate of the heap one answer takes: the key, and a place of two numbers or a word. */
function answerSize(key: string): number {
  return 2 * key.length + 96;
}

/** The mention with the text it makes, which is not kept: it is the whole note. */
function withLink(content: string, place: Place): Place & { linked: string } {
  const { start, end } = place;
  return { start, end, linked: `${content.slice(0, start)}[[${content.slice(start, end)}]]${content.slice(end)}` };
}
/** How many of them are held in memory at a time. A note can be a megabyte. */
const BATCH = 25;
/** How much of the line is shown on each side of a mention. */
const SNIPPET_LENGTH = 80;

/**
 * Notes that mention another note's title without linking to it, and the
 * "Link" that turns such a mention into a [[link]].
 */
@Injectable()
export class MentionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
    private readonly pool: ParsePool,
    private readonly versions: VersionsService,
  ) {}

  /**
   * The notes of this user, outside the trash, that write the title of
   * `noteId` in plain text and have no link to it. The full-text index names
   * the candidates, newest first. Each one is then read, because the index
   * cannot tell a mention from one inside code or a link, and matches word
   * stems where a title has to match as written. For each note the first
   * mention that "Link" would accept is given, found with the same function
   * "Link" uses, so every mention listed can be linked.
   *
   * With `notebookIds`, only notes in those notebooks are read for mentions:
   * what a member of a shared notebook may see of its owner's notes.
   * `callerId` is who asked, and holds the slot of the limit on lookups at
   * once: a member reading the owner's notes uses up their own slots, never
   * the owner's.
   */
  async list(
    userId: string,
    noteId: string,
    page: PaginationQuery,
    notebookIds?: string[],
    callerId: string = userId,
  ): Promise<MentionPage> {
    return this.oneAtATime(callerId, () => this.listNow(userId, noteId, page, notebookIds));
  }

  private async listNow(
    userId: string,
    noteId: string,
    page: PaginationQuery,
    notebookIds?: string[],
  ): Promise<MentionPage> {
    const target = await this.findNote(userId, noteId);
    if (await this.whyNot(userId, target)) {
      return { items: [], total: 0, page: page.page, pageSize: page.pageSize, capped: false };
    }

    const candidates = await this.candidateIds(userId, target, MAX_CANDIDATES + 1, notebookIds);
    let capped = candidates.length > MAX_CANDIDATES;
    let budget = MAX_PARSED_LENGTH;
    const deadline = Date.now() + MAX_PARSE_MS;
    let spent = false;
    const mentions: Mention[] = [];
    for (let from = 0; from < Math.min(candidates.length, MAX_CANDIDATES) && !spent; from += BATCH) {
      const ids = candidates.slice(from, Math.min(from + BATCH, MAX_CANDIDATES));
      const notes = await this.prisma.note.findMany({
        where: {
          id: { in: ids },
          ...workingNotes(userId),
          ...(notebookIds ? { notebookId: { in: notebookIds } } : {}),
        },
        select: { id: true, title: true, content: true, updatedAt: true, revision: true },
      });
      // findMany does not promise the order of the ids it was given.
      const byId = new Map(notes.map((note) => [note.id, note]));
      for (const id of ids) {
        const note = byId.get(id);
        // A quick look at the raw text first: most candidates of the index only share the word stems.
        if (!note || !mayMention(note.content, target.title)) continue;
        budget -= note.content.length;
        if (budget < 0 || Date.now() > deadline) {
          capped = spent = true;
          break;
        }
        const mention = await this.mentionIn(userId, note, target.title);
        if (mention === 'unavailable' || mention === 'busy') {
          throw new ServiceUnavailableException(
            'Unlinked mentions are not available right now. Try again in a moment.',
          );
        }
        if (mention && mention !== 'unparseable' && mention.linked.length <= MAX_CONTENT_LENGTH) {
          mentions.push({
            id: note.id,
            title: note.title,
            updatedAt: note.updatedAt,
            ...lineAround(note.content, mention.start, mention.end),
            offset: mention.start,
            version: note.revision,
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
   * Wraps one mention of `noteId`'s title in the note `sourceId` in [[ ]]:
   * the one that starts at `at.offset` and reads `at.text`, in the text the
   * note had at revision `at.version`. That is what the list showed, so what
   * was shown is what gets linked. If the note has changed since, nothing is
   * written and the answer is 409. The write goes through writeNoteText
   * with that revision, like every other change to a note's text, so an
   * edit that lands in between cannot be overwritten either.
   *
   * The text that is replaced is saved as a version first, so the change can
   * be undone from the history of that note. Its "last edited" time stays
   * as it was: the app made this change, and the note should not jump to
   * the top of every list for it.
   */
  async link(
    userId: string,
    noteId: string,
    sourceId: string,
    at: { offset: number; text: string; version: number },
  ): Promise<void> {
    return this.oneAtATime(userId, () => this.linkNow(userId, noteId, sourceId, at));
  }

  private async linkNow(
    userId: string,
    noteId: string,
    sourceId: string,
    at: { offset: number; text: string; version: number },
  ): Promise<void> {
    const target = await this.findNote(userId, noteId);
    const changed = () => new ConflictException('That note has changed since its mention was listed');

    // The new text is worked out before the transaction, since the parse can take a moment.
    const source = await this.prisma.note.findFirst({ where: { id: sourceId, ...workingNotes(userId) } });
    if (!source || source.id === target.id) {
      throw new NotFoundException('Note not found');
    }
    if (source.revision !== at.version) {
      throw changed();
    }
    const mention = await this.mentionIn(userId, source, target.title, at);
    if (mention === 'busy') {
      throw new HttpException(
        'Too many notes are being read for mentions. Try again in a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (mention === 'unavailable') {
      throw new BadRequestException('Mentions are not available right now. Try again in a moment.');
    }
    if (mention === 'unparseable') {
      throw new BadRequestException('That note is too long or too intricate to look for mentions in');
    }
    if (mention === null) {
      throw new ConflictException(`That note does not mention "${target.title}" there`);
    }
    if (mention.linked.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException('That note is too long to take the four characters of a link');
    }

    await this.prisma.$transaction(async (tx) => {
      const refused = await this.whyNot(userId, target, tx);
      if (refused) {
        throw new ConflictException(refused);
      }
      // Tied to the revision the text was worked out from: a save that got in between makes this fail instead of being lost.
      if (!(await writeNoteText(tx, { id: source.id, userId, revision: at.version }, { content: mention.linked }))) {
        throw changed();
      }
      await this.versions.snapshot(tx, source);
      await this.links.sync(tx, source.id, mention.linked);
    });
  }

  /**
   * The mention of `title` in `note` that "Link" can wrap, the one at `at`
   * when it is given, or "unparseable". The parse runs in the pool. Its tree
   * is kept by note and revision, so each revision of a note is parsed once
   * whatever title is looked for, and so is the answer for a title. A note
   * the parser gives up on, or runs out of time on, is not tried again until
   * it is edited.
   */
  private async mentionIn(
    userId: string,
    note: { id: string; revision: number; content: string },
    title: string,
    at?: { offset: number; text: string },
  ): Promise<Found> {
    // The text is part of the key: an id can come back with other text after a note was deleted for good.
    const treeKey = `${userId}:${note.id}:${note.revision}:${createHash('sha256').update(note.content).digest('base64')}`;
    const answerKey = at ? null : `${treeKey}:${normalizeTitle(title)}`;
    const known = answerKey === null ? undefined : this.answers.get(answerKey);
    if (known !== undefined) {
      this.touch(this.answers, answerKey!);
      return known === null || known === 'unparseable' ? known : withLink(note.content, known);
    }
    const tree = this.trees.get(treeKey);
    if (tree) this.touch(this.trees, treeKey);
    if (tree?.parsed === null) return 'unparseable';

    const answer = await this.pool.run({ text: note.content, title, at, parsed: tree?.parsed });
    // Not the note's fault: nothing is kept, and the next request tries again.
    if (answer === 'unavailable' || answer === 'busy') return answer;
    const parsed = answer === 'timeout' ? null : answer.parsed;
    if (!tree || answer === 'timeout') this.keepTree(treeKey, parsed);
    const result = parsed && answer !== 'timeout' ? answer.mention : 'unparseable';
    if (answerKey !== null) {
      this.keepAnswer(
        answerKey,
        result === null || result === 'unparseable' ? result : { start: result.start, end: result.end },
      );
    }
    return result;
  }

  /**
   * Parsed notes and answers, least recently used first, each with an
   * estimate of the memory it takes. Both are bounded by that estimate.
   */
  private readonly trees = new Map<string, { parsed: ParsedNote | null; bytes: number }>();
  private treeBytes = 0;
  private readonly answers = new Map<string, Place | null | 'unparseable'>();
  private answerBytes = 0;
  /** Mention requests running now, by user. */
  private readonly running = new Map<string, number>();

  private touch<T>(cache: Map<string, T>, key: string): void {
    const value = cache.get(key) as T;
    cache.delete(key);
    cache.set(key, value);
  }

  private keepTree(key: string, parsed: ParsedNote | null): void {
    const old = this.trees.get(key);
    if (old) this.treeBytes -= old.bytes;
    const bytes = 2 * key.length + treeSize(parsed);
    this.trees.delete(key);
    this.trees.set(key, { parsed, bytes });
    this.treeBytes += bytes;
    for (const [oldest, entry] of this.trees) {
      if (this.treeBytes <= CACHED_TREE_BYTES) break;
      this.trees.delete(oldest);
      this.treeBytes -= entry.bytes;
    }
  }

  private keepAnswer(key: string, answer: Place | null | 'unparseable'): void {
    if (this.answers.has(key)) this.answerBytes -= answerSize(key);
    this.answers.delete(key);
    this.answers.set(key, answer);
    this.answerBytes += answerSize(key);
    for (const oldest of this.answers.keys()) {
      if (this.answerBytes <= CACHED_ANSWER_BYTES) break;
      this.answers.delete(oldest);
      this.answerBytes -= answerSize(oldest);
    }
  }

  /** Runs `work` unless the user has MAX_REQUESTS_PER_USER mention requests running already. */
  private async oneAtATime<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const now = this.running.get(userId) ?? 0;
    if (now >= MAX_REQUESTS_PER_USER) {
      throw new HttpException(
        'Too many mention requests at once. Try again in a moment.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.running.set(userId, now + 1);
    try {
      return await work();
    } finally {
      const left = (this.running.get(userId) ?? 1) - 1;
      if (left > 0) this.running.set(userId, left);
      else this.running.delete(userId);
    }
  }

  /**
   * Why no mention of this note is offered, and none is linked, or null
   * when there is no such reason. A link is the title in brackets, so it
   * only leads to this note for certain when no other note has the title.
   */
  private async whyNot(
    userId: string,
    target: Note,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<string | null> {
    if (target.deletedAt) {
      return 'Restore the note from the trash before linking to it';
    }
    if (normalizeTitle(target.title) === normalizeTitle(DEFAULT_TITLE)) {
      return 'A note that is still called "Untitled" cannot be told from the others by its title';
    }
    // Very short titles are mostly just words, and some titles cannot be written as a [[link]] at all.
    if (!isMentionable(target.title)) {
      return 'The title is too short to look for, or cannot be written as a link';
    }
    if (await this.links.titleTaken(userId, target.title, { except: target.id, db })) {
      return 'Another note has the same title, so a link would not be sure to lead to this one';
    }
    return null;
  }

  /** Ids of the notes whose indexed words contain the title as a phrase and that do not link to it yet. */
  private async candidateIds(userId: string, target: Note, limit: number, notebookIds?: string[]): Promise<string[]> {
    const inside = notebookIds
      ? notebookIds.length > 0
        ? Prisma.sql`AND n.notebook_id IN (${Prisma.join(notebookIds.map((id) => Prisma.sql`${id}::uuid`))})`
        : Prisma.sql`AND false`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT n.id
      FROM notes n
      WHERE n.user_id = ${userId}::uuid AND ${workingNoteSql('n')} AND n.id <> ${target.id}::uuid ${inside}
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

/** Takes the marks of Markdown out of a piece of a line and collapses its spaces, keeping the ones at its ends. */
function plain(piece: string): string {
  return piece.replace(/[|#>*`_~]+/g, ' ').replace(/\s+/g, ' ');
}

/**
 * The line that the stretch from `start` to `end` is in, as what stands
 * before it, the stretch itself and what follows, each side cut at a word
 * when it is long. Around a mention this is what a reader needs to see to
 * know which one "Link" is about.
 */
export function lineAround(
  content: string,
  start: number,
  end: number,
): { before: string; match: string; after: string } {
  // A lone \r ends a line as well.
  const lineStart = Math.max(content.lastIndexOf('\n', start - 1), content.lastIndexOf('\r', start - 1)) + 1;
  const lineEnd = content.slice(end).search(/[\r\n]/);
  let before = plain(content.slice(lineStart, start))
    .replace(/^\s*(?:[-+]|\d+[.)])?\s*(?:\[[ xX]\]\s*)?/, '')
    .trimStart();
  let after = plain(content.slice(end, lineEnd === -1 ? content.length : end + lineEnd)).trimEnd();
  if (before.length > SNIPPET_LENGTH) before = `…${before.slice(-SNIPPET_LENGTH).replace(/^\S*\s/, '')}`;
  if (after.length > SNIPPET_LENGTH) after = `${after.slice(0, SNIPPET_LENGTH).replace(/\s\S*$/, '')}…`;
  return { before, match: content.slice(start, end), after };
}
