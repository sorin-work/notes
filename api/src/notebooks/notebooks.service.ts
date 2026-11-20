import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Notebook, Prisma } from '@prisma/client';
import { templateNotes, WORKING_NOTE } from '../notes/note-scope';
import { notebookShareSelect, sharedThrough, SharedThrough } from '../notes/note-view';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotebookDto, UpdateNotebookDto } from './dto/notebook.dto';

export interface NotebookView {
  id: string;
  name: string;
  parentId: string | null;
  noteCount: number;
  /**
   * Templates are not counted as notes, but they are in the notebook all the
   * same, and deleting it moves them to the trash with the notes.
   */
  templateCount: number;
  /** Whether the notebook has a share link of its own. */
  shared: boolean;
  /**
   * The shared notebook that makes this one public, itself or the nearest
   * one it is inside at any depth, if one does.
   */
  sharedThrough: SharedThrough | null;
  createdAt: Date;
  updatedAt: Date;
}

/** How deep notebooks nest. A notebook at the top is level 1, so this allows three levels inside it. */
export const MAX_NOTEBOOK_DEPTH = 4;
const TOO_DEEP = `Notebooks can be nested ${MAX_NOTEBOOK_DEPTH} levels deep at most`;

/** Every notebook of one user with its parent: the shape of the tree. */
export type NotebookParents = Map<string, string | null>;

/** The level a notebook sits at: 1 at the top, 2 inside a top-level notebook, and so on. */
export function depthOf(parents: NotebookParents, id: string): number {
  let depth = 0;
  // The size of the map bounds the walk, should the data ever hold a loop.
  for (let at: string | null | undefined = id; at && depth <= parents.size; at = parents.get(at)) depth++;
  return depth;
}

/** How many levels a notebook takes up together with what is inside it: 1 for one with nothing inside. */
export function heightOf(parents: NotebookParents, id: string, seen = new Set<string>()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  let tallest = 0;
  for (const [child, parent] of parents) {
    if (parent === id) tallest = Math.max(tallest, heightOf(parents, child, seen));
  }
  return 1 + tallest;
}

/** Whether `id` is `ancestor` itself or sits somewhere inside it. */
export function isInside(parents: NotebookParents, id: string, ancestor: string): boolean {
  let steps = 0;
  for (let at: string | null | undefined = id; at && steps <= parents.size; at = parents.get(at), steps++) {
    if (at === ancestor) return true;
  }
  return false;
}

const notebookInclude = {
  _count: { select: { notes: { where: WORKING_NOTE } } },
  share: { select: { expiresAt: true } },
  parent: { select: notebookShareSelect },
} satisfies Prisma.NotebookInclude;

function toNotebookView(
  notebook: Prisma.NotebookGetPayload<{ include: typeof notebookInclude }>,
  templateCount: number,
): NotebookView {
  const { _count, userId: _userId, share, parent, ...rest } = notebook;
  return {
    ...rest,
    noteCount: _count.notes,
    templateCount,
    shared: share !== null,
    sharedThrough: sharedThrough({ id: rest.id, name: rest.name, share, parent }),
  };
}

@Injectable()
export class NotebooksService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<NotebookView[]> {
    const notebooks = await this.prisma.notebook.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: notebookInclude,
    });
    const templates = await this.templateCounts(userId);
    return notebooks.map((notebook) => toNotebookView(notebook, templates.get(notebook.id) ?? 0));
  }

  async create(userId: string, dto: CreateNotebookDto): Promise<NotebookView> {
    const parentId = dto.parentId ?? null;
    const created = await this.prisma.$transaction(async (tx) => {
      const parents = await this.lockTree(tx, userId);
      if (parentId) {
        if (!parents.has(parentId)) {
          throw new NotFoundException('Parent notebook not found');
        }
        if (depthOf(parents, parentId) >= MAX_NOTEBOOK_DEPTH) {
          throw new BadRequestException(TOO_DEEP);
        }
      }
      await this.assertNameFree(tx, userId, parentId, dto.name);
      return tx.notebook.create({ data: { userId, name: dto.name, parentId }, include: notebookInclude });
    });
    return toNotebookView(created, 0);
  }

  /**
   * Renames a notebook or moves it, with everything inside it, under another
   * one or to the top. The checks and the move share one transaction that
   * holds the lock of lockTree, so two moves that each look fine alone, such
   * as A into B and B into A, cannot both go through and leave a loop.
   */
  async update(userId: string, id: string, dto: UpdateNotebookDto): Promise<NotebookView> {
    await this.prisma.$transaction(async (tx) => {
      const parents = await this.lockTree(tx, userId);
      const notebook = await tx.notebook.findFirst({ where: { id, userId } });
      if (!notebook) {
        throw new NotFoundException('Notebook not found');
      }
      const parentId = dto.parentId === undefined ? notebook.parentId : dto.parentId;

      if (parentId !== notebook.parentId && parentId !== null) {
        if (parentId === notebook.id) {
          throw new BadRequestException('A notebook cannot be nested inside itself');
        }
        if (!parents.has(parentId)) {
          throw new NotFoundException('Parent notebook not found');
        }
        if (isInside(parents, parentId, notebook.id)) {
          throw new BadRequestException('A notebook cannot be moved into a notebook that is inside it');
        }
        if (depthOf(parents, parentId) + heightOf(parents, notebook.id) > MAX_NOTEBOOK_DEPTH) {
          throw new BadRequestException(TOO_DEEP);
        }
      }

      const name = dto.name ?? notebook.name;
      if (name !== notebook.name || parentId !== notebook.parentId) {
        // The notebook itself does not count, so changing only the case of its name works.
        await this.assertNameFree(tx, userId, parentId, name, notebook.id);
      }
      await tx.notebook.update({ where: { id }, data: { name, parentId } });
    });
    return this.view(userId, id);
  }

  /**
   * Deletes the notebook and every notebook inside it, however deep. Their
   * notes are moved to the trash rather than deleted, so nothing is lost by
   * accident.
   */
  async remove(userId: string, id: string): Promise<{ trashedNotes: number }> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTree(tx, userId);
      const ids = await this.idsWithChildren(userId, id, tx);
      const trashed = await tx.note.updateMany({
        where: { userId, notebookId: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      // The notebooks inside go with it: the database deletes them along.
      await tx.notebook.delete({ where: { id } });
      return { trashedNotes: trashed.count };
    });
  }

  async findOwned(userId: string, id: string): Promise<Notebook> {
    const notebook = await this.prisma.notebook.findFirst({ where: { id, userId } });
    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }
    return notebook;
  }

  /**
   * The notebook and every notebook below it, at any depth, the notebook
   * itself first. It is one recursive query, and it is what "this notebook
   * and what is inside it" means everywhere: the note list, the search, the
   * graph and deleting. 404s for a notebook that is not this user's.
   */
  async idsWithChildren(
    userId: string,
    id: string,
    db: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma,
  ): Promise<string[]> {
    // The level stops the walk if the data should ever hold a loop.
    const rows = await db.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id, 1 AS level
        FROM notebooks
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid
        UNION ALL
        SELECT child.id, tree.level + 1
        FROM notebooks child JOIN tree ON child.parent_id = tree.id
        WHERE child.user_id = ${userId}::uuid AND tree.level < ${MAX_NOTEBOOK_DEPTH * 4}
      )
      SELECT id FROM tree GROUP BY id ORDER BY min(level), id`;
    if (rows.length === 0) {
      throw new NotFoundException('Notebook not found');
    }
    return rows.map((row) => row.id);
  }

  /**
   * The notebook at `path`, a list of names from the top down, made where it
   * is missing: what an import needs for each folder. Names match the way
   * they are kept unique, ignoring case. It runs inside the caller's
   * transaction `tx` and takes the lock of lockTree first, so a move or
   * another import cannot change the tree while it walks down, and it
   * refuses a path deeper than notebooks nest. Returns null for an empty
   * path, and how many notebooks it made.
   */
  async findOrCreatePath(
    tx: Prisma.TransactionClient,
    userId: string,
    path: string[],
  ): Promise<{ id: string | null; created: number }> {
    if (path.length > MAX_NOTEBOOK_DEPTH) {
      throw new BadRequestException(TOO_DEEP);
    }
    if (path.length === 0) return { id: null, created: 0 };
    await this.lock(tx, userId);
    let parentId: string | null = null;
    let created = 0;
    // From the top down, so each notebook found sits exactly at the level of its name in the path.
    for (const name of path) {
      const existing: { id: string } | null = await tx.notebook.findFirst({
        where: { userId, parentId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        parentId = existing.id;
      } else {
        parentId = (await tx.notebook.create({ data: { userId, parentId, name }, select: { id: true } })).id;
        created++;
      }
    }
    return { id: parentId, created };
  }

  /**
   * Takes the lock that every change to the shape of a user's notebooks
   * holds until its transaction ends, then reads that shape. Requests that
   * create, move or delete notebooks of one user so run one after the other,
   * and each sees what the one before it did. Notes are not held up by it.
   */
  private async lockTree(tx: Prisma.TransactionClient, userId: string): Promise<NotebookParents> {
    await this.lock(tx, userId);
    const notebooks = await tx.notebook.findMany({ where: { userId }, select: { id: true, parentId: true } });
    return new Map(notebooks.map((notebook) => [notebook.id, notebook.parentId]));
  }

  private async lock(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
  }

  private async view(userId: string, id: string): Promise<NotebookView> {
    const notebook = await this.prisma.notebook.findFirstOrThrow({ where: { id, userId }, include: notebookInclude });
    const templates = await this.templateCounts(userId, id);
    return toNotebookView(notebook, templates.get(id) ?? 0);
  }

  /** How many templates each notebook holds, by notebook id. */
  private async templateCounts(userId: string, notebookId?: string): Promise<Map<string, number>> {
    const groups = await this.prisma.note.groupBy({
      by: ['notebookId'],
      where: { ...templateNotes(userId), notebookId: notebookId ?? { not: null } },
      _count: { _all: true },
    });
    return new Map(groups.map((group) => [group.notebookId ?? '', group._count._all]));
  }

  private async assertNameFree(
    tx: Prisma.TransactionClient,
    userId: string,
    parentId: string | null,
    name: string,
    exceptId?: string,
  ) {
    const clash = await tx.notebook.findFirst({
      where: {
        userId,
        parentId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash) {
      throw new ConflictException(`There is already a notebook called "${clash.name}" here`);
    }
  }
}
