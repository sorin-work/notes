import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Notebook, Prisma } from '@prisma/client';
import { Access, AccessService } from '../access/access.service';
import { templateNotes, WORKING_NOTE } from '../notes/note-scope';
import { sharedThrough, SharedThrough } from '../notes/note-view';
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
   * The shared notebook that makes this one public, itself or the one it is
   * inside, if one does.
   */
  sharedThrough: SharedThrough | null;
  /** `owner`, or the role of a member for a notebook shared with them. */
  access: Access;
  /** For a notebook shared with you: whose it is. */
  owner: { name: string } | null;
  /** How many other accounts it is shared with. Only the owner is told. */
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const notebookInclude = {
  _count: { select: { notes: { where: WORKING_NOTE }, members: true } },
  share: { select: { expiresAt: true } },
  parent: { select: { id: true, name: true, share: { select: { expiresAt: true } } } },
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
    access: 'owner',
    owner: null,
    memberCount: _count.members,
  };
}

@Injectable()
export class NotebooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /**
   * The notebooks other accounts share with this one, the ones inside them
   * included. A member sees the name, the role, whose it is and how many
   * notes are in it: not the templates, the share links or the members.
   * A notebook shared without its parent is shown at the top level.
   */
  async listShared(userId: string): Promise<NotebookView[]> {
    const shared = await this.access.sharedNotebooks(userId);
    if (shared.size === 0) return [];
    const notebooks = await this.prisma.notebook.findMany({
      where: { id: { in: [...shared.keys()] } },
      orderBy: { name: 'asc' },
      include: { ...notebookInclude, user: { select: { name: true } } },
    });
    return notebooks.map(({ user, ...notebook }) => {
      const view = toNotebookView(notebook, 0);
      return {
        ...view,
        parentId: view.parentId && shared.has(view.parentId) ? view.parentId : null,
        shared: false,
        sharedThrough: null,
        access: shared.get(notebook.id)!.role,
        owner: { name: user.name },
        memberCount: 0,
      };
    });
  }

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
    if (parentId) {
      await this.assertCanBeParent(userId, parentId);
    }
    await this.assertNameFree(userId, parentId, dto.name);
    const notebook = await this.prisma.notebook.create({
      data: { userId, name: dto.name, parentId },
      include: notebookInclude,
    });
    return toNotebookView(notebook, 0);
  }

  async update(userId: string, id: string, dto: UpdateNotebookDto): Promise<NotebookView> {
    const notebook = await this.findOwned(userId, id);
    const parentId = dto.parentId === undefined ? notebook.parentId : dto.parentId;

    if (parentId !== notebook.parentId && parentId !== null) {
      if (parentId === notebook.id) {
        throw new BadRequestException('A notebook cannot be nested inside itself');
      }
      await this.assertCanBeParent(userId, parentId);
      const childCount = await this.prisma.notebook.count({ where: { parentId: notebook.id } });
      if (childCount > 0) {
        throw new BadRequestException('A notebook that has notebooks inside it cannot be nested');
      }
    }

    const name = dto.name ?? notebook.name;
    if (name !== notebook.name || parentId !== notebook.parentId) {
      // The notebook itself does not count, so changing only the case of its name works.
      await this.assertNameFree(userId, parentId, name, notebook.id);
    }

    await this.prisma.notebook.update({ where: { id }, data: { name, parentId } });
    return this.view(userId, id);
  }

  /**
   * Deletes the notebook and the notebooks inside it. Their notes are moved
   * to the trash rather than deleted, so nothing is lost by accident.
   */
  async remove(userId: string, id: string): Promise<{ trashedNotes: number }> {
    await this.findOwned(userId, id);
    const children = await this.prisma.notebook.findMany({ where: { parentId: id }, select: { id: true } });
    const ids = [id, ...children.map((child) => child.id)];

    const [trashed] = await this.prisma.$transaction([
      this.prisma.note.updateMany({
        where: { userId, notebookId: { in: ids }, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
      this.prisma.notebook.delete({ where: { id } }),
    ]);
    return { trashedNotes: trashed.count };
  }

  async findOwned(userId: string, id: string): Promise<Notebook> {
    const notebook = await this.prisma.notebook.findFirst({ where: { id, userId } });
    if (!notebook) {
      throw new NotFoundException('Notebook not found');
    }
    return notebook;
  }

  /** The notebook and, for a top-level notebook, the ids of the notebooks inside it. */
  async idsWithChildren(userId: string, id: string): Promise<string[]> {
    await this.findOwned(userId, id);
    const children = await this.prisma.notebook.findMany({ where: { userId, parentId: id }, select: { id: true } });
    return [id, ...children.map((child) => child.id)];
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

  private async assertCanBeParent(userId: string, parentId: string): Promise<void> {
    const parent = await this.prisma.notebook.findFirst({ where: { id: parentId, userId } });
    if (!parent) {
      throw new NotFoundException('Parent notebook not found');
    }
    if (parent.parentId) {
      throw new BadRequestException('Notebooks can only be nested one level deep');
    }
  }

  private async assertNameFree(userId: string, parentId: string | null, name: string, exceptId?: string) {
    const clash = await this.prisma.notebook.findFirst({
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
