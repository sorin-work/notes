import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { MemberRole, Prisma } from '@prisma/client';
import { subtreeOf } from '../notebooks/subtree';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Who may do what with a note or a notebook. Every route that takes a note or
 * a notebook asks here first, and nowhere else.
 *
 * The owner may do everything. A member of a shared notebook may read the
 * notes in it, and in the notebooks inside it, or also edit their text and
 * tags, depending on the role. Anyone else gets a 404, the same as for a note
 * that does not exist, so nothing tells them a note is there.
 *
 * What comes back is the id of the owner. The services below keep looking
 * notes up by `{ id, userId }`, with that owner id: a route that forgot to ask
 * here would find only the caller's own notes, so the mistake fails closed.
 */
export type Access = 'owner' | MemberRole;
/** What a route needs: to read, to change text and tags, or to be the owner. */
export type Need = 'read' | 'edit' | 'owner';

/**
 * The access check again, as the first thing inside the transaction that
 * writes: see AccessService.inWrite.
 */
export type WriteGuard = (tx: Prisma.TransactionClient) => Promise<void>;

export interface Granted {
  ownerId: string;
  access: Access;
}

/** A notebook shared with someone: through itself or the notebook it is inside. */
export interface SharedNotebook {
  ownerId: string;
  role: MemberRole;
  /** The notebook the membership is on: this one or its parent. */
  rootId: string;
}

const NOT_FOUND = 'Note not found';
const ONLY_OWNER = 'Only the owner of the notebook can do this.';
const READ_ONLY = 'This notebook is shared with you to read, not to change.';

function check(access: Access, need: Need): void {
  if (need === 'owner' && access !== 'owner') throw new ForbiddenException(ONLY_OWNER);
  if (need === 'edit' && access === 'read') throw new ForbiddenException(READ_ONLY);
}

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The notebooks shared with a user, by id: each shared notebook and every
   * notebook below it, at any depth, the same set the owner's note list and
   * search mean by "this notebook" (subtreeOf). A notebook shared both by
   * itself and through one above it takes the wider role.
   */
  async sharedNotebooks(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Map<string, SharedNotebook>> {
    const memberships = await db.notebookMember.findMany({
      where: { userId },
      include: { notebook: { select: { id: true, userId: true } } },
    });
    const shared = new Map<string, SharedNotebook>();
    const add = (id: string, entry: SharedNotebook) => {
      const known = shared.get(id);
      if (!known || (known.role === 'read' && entry.role === 'edit')) shared.set(id, entry);
    };
    for (const { notebook, role } of memberships) {
      const entry = { ownerId: notebook.userId, role, rootId: notebook.id };
      for (const id of await subtreeOf(db, notebook.userId, notebook.id)) add(id, entry);
    }
    return shared;
  }

  /** The ids of the notebooks of `ownerId` that `userId` may read, or null when `userId` is the owner. */
  async visibleNotebookIds(userId: string, ownerId: string): Promise<Set<string> | null> {
    if (userId === ownerId) return null;
    const shared = await this.sharedNotebooks(userId);
    return new Set([...shared].filter(([, entry]) => entry.ownerId === ownerId).map(([id]) => id));
  }

  /**
   * Whether `userId` may do `need` with a note. A member never sees a note in
   * the trash or a template, even in a shared notebook. 404 when the note is
   * not theirs to see, 403 when they may see it but not do this.
   */
  async note(userId: string, noteId: string, need: Need, db: Prisma.TransactionClient = this.prisma): Promise<Granted> {
    const note = await db.note.findUnique({
      where: { id: noteId },
      select: { userId: true, notebookId: true, deletedAt: true, isTemplate: true },
    });
    if (!note) throw new NotFoundException(NOT_FOUND);
    if (note.userId === userId) return { ownerId: userId, access: 'owner' };
    if (!note.notebookId || note.deletedAt || note.isTemplate) throw new NotFoundException(NOT_FOUND);
    const shared = (await this.sharedNotebooks(userId, db)).get(note.notebookId);
    if (!shared || shared.ownerId !== note.userId) throw new NotFoundException(NOT_FOUND);
    check(shared.role, need);
    return { ownerId: note.userId, access: shared.role };
  }

  /**
   * The check to run again inside the transaction that writes to a note.
   * The note's row is locked first, and the user's memberships are read with
   * a share lock: a move of the note, or the removal of the member, either
   * waits for the write or is seen by the check. The check before the
   * transaction only decides whose note to load; this one decides the write.
   */
  noteWriteGuard(userId: string, noteId: string, need: Need): WriteGuard {
    return async (tx) => {
      await tx.$queryRaw`SELECT id FROM notes WHERE id = ${noteId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT notebook_id FROM notebook_members WHERE user_id = ${userId}::uuid FOR SHARE`;
      await this.note(userId, noteId, need, tx);
    };
  }

  /** The same for adding a note to a notebook: its row and the memberships locked, then the check. */
  notebookWriteGuard(userId: string, notebookId: string, need: Need): WriteGuard {
    return async (tx) => {
      await tx.$queryRaw`SELECT id FROM notebooks WHERE id = ${notebookId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT notebook_id FROM notebook_members WHERE user_id = ${userId}::uuid FOR SHARE`;
      await this.notebook(userId, notebookId, need, tx);
    };
  }

  /** Whether `userId` may do `need` with a notebook, in the same way. */
  async notebook(
    userId: string,
    notebookId: string,
    need: Need,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Granted> {
    const notebook = await db.notebook.findUnique({ where: { id: notebookId }, select: { userId: true } });
    if (!notebook) throw new NotFoundException('Notebook not found');
    if (notebook.userId === userId) return { ownerId: userId, access: 'owner' };
    const shared = (await this.sharedNotebooks(userId, db)).get(notebookId);
    if (!shared || shared.ownerId !== notebook.userId) throw new NotFoundException('Notebook not found');
    check(shared.role, need);
    return { ownerId: notebook.userId, access: shared.role };
  }

  /**
   * For a filter by notebook: whose notes to look in. The caller's own, unless
   * the notebook is shared with them, then the owner's. `null` for no filter.
   */
  async ownerForFilter(userId: string, notebookId: string | undefined | null): Promise<Granted> {
    if (!notebookId || notebookId === 'none') return { ownerId: userId, access: 'owner' };
    const notebook = await this.prisma.notebook.findUnique({ where: { id: notebookId }, select: { userId: true } });
    if (!notebook || notebook.userId === userId) return { ownerId: userId, access: 'owner' };
    return this.notebook(userId, notebookId, 'read');
  }
}
