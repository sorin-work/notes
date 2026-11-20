import { ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { noteInclude, NoteView, toView } from './note-view';

export const IN_TRASH = 'This note is in the trash. Restore it before changing it.';

/** Tells a refused save from the other 409s, such as changing a note in the trash. */
export const STALE_REVISION = 'stale_revision';

/**
 * What a create gets back when its id is taken. It is the same answer
 * whoever has the note, so it says nothing about other people's notes: a
 * client that wants to know whether the note is its own asks for it by id.
 */
export const NOTE_EXISTS = 'note_exists';

export class NoteExistsException extends ConflictException {
  constructor() {
    super({ statusCode: 409, error: 'Conflict', message: 'A note with this id already exists.', code: NOTE_EXISTS });
  }
}

/** What a save gets back when the note has changed since the revision it was based on. */
export interface NoteConflictBody {
  statusCode: 409;
  error: 'Conflict';
  message: string;
  code: typeof STALE_REVISION;
  /** The note as it is now. Its revision is the one the next save has to name. */
  note: NoteView;
}

export class NoteConflictException extends ConflictException {
  constructor(note: NoteView) {
    const body: NoteConflictBody = {
      statusCode: 409,
      error: 'Conflict',
      message: 'This note was changed somewhere else since it was opened.',
      code: STALE_REVISION,
      note,
    };
    super(body);
  }
}

/**
 * The way to change the title or the content of a note: the normal save,
 * restoring a version, rewriting links, and whatever comes later.
 *
 * With `revision`, the text is only written while the note is still at that
 * revision. The check and the write are one statement, so of two saves based
 * on the same revision only one gets through. Without it the last write wins.
 * The revision itself is bumped by a trigger in that same statement, and only
 * when the title or the content really changed.
 *
 * Returns false when nothing was written: the note has another revision, is
 * in the trash or is gone. After a true, the row stays locked until the
 * transaction ends, so what the transaction reads next is what it wrote.
 */
export async function writeNoteText(
  tx: Prisma.TransactionClient,
  where: { id: string; userId: string; revision?: number },
  text: { title?: string; content?: string },
): Promise<boolean> {
  const written = await tx.note.updateMany({ where: { ...where, deletedAt: null }, data: text });
  return written.count === 1;
}

/**
 * Why a save found no note to write to, as the error to answer with: the
 * note is gone, it is in the trash, or it has changed. In the last case the
 * answer carries the note as it is now.
 */
export async function refusedWrite(tx: Prisma.TransactionClient, userId: string, id: string): Promise<HttpException> {
  const current = await tx.note.findFirst({ where: { id, userId }, include: noteInclude });
  if (!current) return new NotFoundException('Note not found');
  if (current.deletedAt) return new ConflictException(IN_TRASH);
  return new NoteConflictException(toView(current));
}
