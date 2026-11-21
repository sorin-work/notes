import { ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { WriteGuard } from '../access/access.service';
import { ParsePool } from '../links/parse-pool';
import { parseable, TaskItem } from '../links/prose';
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
  /** The revision the tasks were read from, which ticking a box has to name. */
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
/** How many notes that need reading are loaded from the database at a time. */
const BATCH = 50;

/** Without a box anywhere in its text, a note has no tasks, and the parser need not look. */
const MAY_HAVE_TASK = /\[[ xX]\]/;

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
      select: { id: true, revision: true, tasksRead: { select: { revision: true, readable: true } } },
    });
    const stale = notes.filter((note) => note.tasksRead?.revision !== note.revision).map((note) => note.id);
    const unread = await this.read(stale);

    const fresh = new Set<string>();
    let unreadable = 0;
    const current = await this.prisma.noteTaskRead.findMany({
      where: { noteId: { in: notes.map((note) => note.id) } },
      select: { noteId: true, revision: true, readable: true },
    });
    const revisions = new Map(notes.map((note) => [note.id, note.revision]));
    for (const read of current) {
      // Tasks read from an older revision have line numbers that may have moved: they are not shown.
      if (read.revision !== revisions.get(read.noteId)) continue;
      if (read.readable) fresh.add(read.noteId);
      else unreadable++;
    }

    const withTasks = await this.prisma.note.findMany({
      where: { id: { in: [...fresh] }, tasks: { some: { done: false } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: MAX_TASK_NOTES + 1,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        notebook: { select: { id: true, name: true } },
        tasksRead: { select: { revision: true } },
        tasks: { where: { done: false }, orderBy: { line: 'asc' }, select: { line: true, text: true } },
      },
    });
    return {
      notes: withTasks.slice(0, MAX_TASK_NOTES).map(({ tasksRead, ...note }) => ({
        ...note,
        revision: tasksRead?.revision ?? 0,
      })),
      unreadable,
      unread,
      capped: withTasks.length > MAX_TASK_NOTES,
    };
  }

  /**
   * Reads the tasks of these notes again, newest first, within the budget
   * of one request. Returns how many were left unread.
   */
  private async read(ids: string[]): Promise<number> {
    const started = performance.now();
    let parsedLength = 0;
    let done = 0;
    for (let at = 0; at < ids.length; at += BATCH) {
      const batch = await this.prisma.note.findMany({
        where: { id: { in: ids.slice(at, at + BATCH) } },
        select: { id: true, revision: true, content: true },
      });
      for (const note of batch) {
        let tasks: TaskItem[] | null;
        if (!MAY_HAVE_TASK.test(note.content)) {
          tasks = [];
        } else if (!parseable(note.content)) {
          tasks = null;
        } else {
          if (parsedLength + note.content.length > MAX_TASK_PARSE_LENGTH) return ids.length - done;
          if (performance.now() - started > MAX_TASK_PARSE_MS) return ids.length - done;
          parsedLength += note.content.length;
          const answer = await this.pool.run({ kind: 'tasks', text: note.content, title: '' });
          // Not the note's fault: it stays unread, and the next request tries again.
          if (answer === 'busy' || answer === 'unavailable') return ids.length - done;
          // A note the parser runs out of time on is not tried again until it is edited.
          tasks = answer === 'timeout' ? null : (answer.tasks ?? null);
        }
        await this.store(note.id, note.revision, tasks);
        done++;
      }
    }
    return 0;
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') return;
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
