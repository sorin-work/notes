import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WriteGuard } from '../access/access.service';
import { ParsePool } from '../links/parse-pool';
import { MAX_PARSED_NOTE_LENGTH, parseable, TaskItem } from '../links/prose';
import { workingNotes } from '../notes/note-scope';
import { refusedWrite } from '../notes/note-text';
import { NoteView } from '../notes/note-view';
import { NotesService } from '../notes/notes.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTagName } from '../tags/tag-name';
import { toggleTask } from './toggle-task';

/** A note with open tasks, as the Tasks page shows it. */
export interface TaskNote {
  id: string;
  title: string;
  updatedAt: Date;
  notebook: { id: string; name: string } | null;
  /** The revision of the note, which its tasks were read from and ticking a box has to name. */
  revision: number;
  tasks: { line: number; text: string }[];
}

export interface TaskList {
  notes: TaskNote[];
  /** Notes the parser could not read: too long or too intricate. Their tasks are not listed. */
  unreadable: number;
  /** Notes not read yet, because this request ran out of its budget or the parser was busy. Asking again reads on. */
  unread: number;
  /** True when more notes have open tasks than are listed. */
  capped: boolean;
}

/** How many notes with open tasks the page lists, newest first. */
export const MAX_TASK_NOTES = 200;
/** How much text one request parses, in characters, and for how long, as for mentions. */
export const MAX_TASK_PARSE_LENGTH = 1_000_000;
export const MAX_TASK_PARSE_MS = 2_000;
/** How many task requests of one user run at a time. More answer 429. */
export const MAX_TASK_REQUESTS_PER_USER = 2;
/**
 * Without a box anywhere in its text, a note has no tasks, and the parser
 * need not look. As a Postgres regular expression.
 */
const BOX_PATTERN = '\\[[ xX]\\]';

/** A row that points at a note that is gone: as Prisma reports it, and as Postgres does through a raw query. */
function isForeignKeyError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2003') return true;
    return error.code === 'P2010' && (error.meta as { code?: string } | undefined)?.code === '23503';
  }
  return false;
}

/**
 * Tasks across notes. The task list items of a note are kept in `NoteTask`,
 * with the revision of the note they were read from in `NoteTaskRead`. They
 * are read when the list is asked for, for every note whose revision has
 * moved on since: so no way of writing a note can leave them behind, and a
 * save never waits for the parser. Notes that exist from before are read the
 * same way, the first time.
 */
@Injectable()
export class TasksService {
  private readonly running = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: ParsePool,
    private readonly notes: NotesService,
  ) {}

  /**
   * The open tasks in the working notes of `ownerId` (outside the trash, not
   * templates), grouped by note, the note edited last first. `notebookIds`
   * narrows them to those notebooks, or with "none" to the notes outside any.
   */
  async list(
    userId: string,
    ownerId: string,
    filter: { notebookIds?: string[] | 'none'; tag?: string },
  ): Promise<TaskList> {
    const running = this.running.get(userId) ?? 0;
    if (running >= MAX_TASK_REQUESTS_PER_USER) {
      throw new HttpException('The tasks are being read already. Try again in a moment.', HttpStatus.TOO_MANY_REQUESTS);
    }
    this.running.set(userId, running + 1);
    try {
      return await this.listFor(ownerId, filter);
    } finally {
      const left = (this.running.get(userId) ?? 1) - 1;
      if (left > 0) this.running.set(userId, left);
      else this.running.delete(userId);
    }
  }

  private async listFor(ownerId: string, filter: { notebookIds?: string[] | 'none'; tag?: string }): Promise<TaskList> {
    const where: Prisma.NoteWhereInput = workingNotes(ownerId);
    if (filter.notebookIds === 'none') where.notebookId = null;
    else if (filter.notebookIds) where.notebookId = { in: filter.notebookIds };
    if (filter.tag) where.tags = { some: { tag: { name: normalizeTagName(filter.tag) ?? filter.tag } } };

    const notes = await this.prisma.note.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: { id: true, revision: true, tasksRead: { select: { revision: true } } },
    });
    await this.read(notes.filter((note) => note.tasksRead?.revision !== note.revision).map((note) => note.id));

    // One snapshot for the counts, the reads and the tasks: a store that lands
    // in between cannot pair tasks of one revision with the revision of another,
    // which a tick would send back.
    return this.prisma.$transaction(
      async (tx) => {
        const now = await tx.note.findMany({
          where,
          select: { id: true, revision: true, tasksRead: { select: { revision: true, readable: true } } },
        });
        const fresh: string[] = [];
        let unreadable = 0;
        let unread = 0;
        for (const note of now) {
          // Not read yet, or edited since it was read (also while this request read others): its lines may have moved.
          if (note.tasksRead?.revision !== note.revision) unread++;
          else if (note.tasksRead.readable) fresh.push(note.id);
          else unreadable++;
        }
        const withTasks = await tx.note.findMany({
          where: { id: { in: fresh }, tasks: { some: { done: false } } },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          take: MAX_TASK_NOTES + 1,
          select: {
            id: true,
            title: true,
            updatedAt: true,
            notebook: { select: { id: true, name: true } },
            revision: true,
            tasks: { where: { done: false }, orderBy: { line: 'asc' }, select: { line: true, text: true } },
          },
        });
        return {
          notes: withTasks.slice(0, MAX_TASK_NOTES),
          unreadable,
          unread,
          capped: withTasks.length > MAX_TASK_NOTES,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /**
   * Reads the tasks of these notes again, within the budget of one request.
   * Notes without a box, and notes too long to parse, are told apart in SQL
   * and written in bulk without their text being loaded. Every other note is
   * loaded, charged by its length and the time spent against the budget,
   * and parsed in the pool. What the budget does not reach stays unread.
   */
  private async read(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.storeInBulk(ids, Prisma.sql`content !~ ${BOX_PATTERN}`, true);
    await this.storeInBulk(
      ids,
      Prisma.sql`content ~ ${BOX_PATTERN} AND length(content) > ${MAX_PARSED_NOTE_LENGTH}`,
      false,
    );

    const candidates = await this.prisma.$queryRaw<{ id: string; length: number }[]>`
      SELECT id, length(content) AS length
      FROM notes
      WHERE id = ANY(${ids}::uuid[]) AND content ~ ${BOX_PATTERN} AND length(content) <= ${MAX_PARSED_NOTE_LENGTH}
      ORDER BY updated_at DESC, id`;
    const started = performance.now();
    let spent = 0;
    for (const { id, length } of candidates) {
      if (spent + length > MAX_TASK_PARSE_LENGTH || performance.now() - started > MAX_TASK_PARSE_MS) return;
      spent += length;
      const note = await this.prisma.note.findUnique({ where: { id }, select: { revision: true, content: true } });
      if (!note) continue;
      if (!parseable(note.content)) {
        await this.store(id, note.revision, null);
        continue;
      }
      const answer = await this.pool.run({ kind: 'tasks', text: note.content, title: '' });
      // Not the note's fault: it stays unread, and the next request tries again.
      if (answer === 'busy' || answer === 'unavailable') return;
      // Out of time on a busy machine says nothing about the note. It stays unread too.
      if (answer === 'timeout') continue;
      await this.store(id, note.revision, answer.tasks ?? null);
    }
  }

  /**
   * Writes the notes among `ids` that `condition` picks as read, with no
   * tasks and `readable` as given, at the revision they have in the same
   * statement. Rows are taken in the order of their ids, so two requests
   * doing this at once cannot lock each other out.
   */
  private async storeInBulk(ids: string[], condition: Prisma.Sql, readable: boolean): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const written = await tx.$queryRaw<{ note_id: string }[]>`
          INSERT INTO note_task_reads (note_id, revision, readable)
          SELECT id, revision, ${readable}::boolean FROM notes
          WHERE id = ANY(${ids}::uuid[]) AND ${condition}
          ORDER BY id
          ON CONFLICT (note_id) DO UPDATE SET revision = EXCLUDED.revision, readable = EXCLUDED.readable
          RETURNING note_id`;
        if (written.length > 0) {
          await tx.noteTask.deleteMany({ where: { noteId: { in: written.map((row) => row.note_id) } } });
        }
      });
    } catch (error) {
      // A note deleted for good under the statement: the others stay unread, and the next request writes them.
      if (isForeignKeyError(error)) return;
      throw error;
    }
  }

  /**
   * Writes what was read from a revision of a note. The row in NoteTaskRead
   * is written first, which locks it: two requests that read the same note
   * at once write one after the other, and the tasks are never doubled. If
   * the note has moved on meanwhile, the row names the old revision, and the
   * next request reads it again.
   */
  private async store(noteId: string, revision: number, tasks: TaskItem[] | null): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.noteTaskRead.upsert({
          where: { noteId },
          create: { noteId, revision, readable: tasks !== null },
          update: { revision, readable: tasks !== null },
        });
        await tx.noteTask.deleteMany({ where: { noteId } });
        if (tasks && tasks.length > 0) {
          await tx.noteTask.createMany({ data: tasks.map((task) => ({ noteId, ...task })) });
        }
      });
    } catch (error) {
      // The note was deleted for good while it was read. There is nothing to keep.
      if (isForeignKeyError(error)) return;
      throw error;
    }
  }

  /**
   * Ticks or unticks the box on `line` of a note, as a save of the note's
   * text tied to `revision`: a note that changed since the list was read is
   * a conflict (409 with the note as it is now), never an overwrite. So is a
   * line that holds no box in the state that was shown. `guard` is the
   * access check of a member, run again inside the transaction that writes.
   */
  async tick(
    ownerId: string,
    noteId: string,
    at: { line: number; checked: boolean; revision: number },
    guard?: WriteGuard,
  ): Promise<NoteView> {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, userId: ownerId, isTemplate: false },
      select: { content: true, revision: true, deletedAt: true },
    });
    if (!note) throw new NotFoundException('Note not found');
    if (note.deletedAt || note.revision !== at.revision) throw await refusedWrite(this.prisma, ownerId, noteId);
    const content = toggleTask(note.content, at.line, at.checked);
    if (content === note.content) {
      throw new ConflictException('That line does not hold a box in that state any more.');
    }
    return this.notes.update(ownerId, noteId, { content, revision: at.revision }, guard);
  }
}
