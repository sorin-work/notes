import { Injectable, NotFoundException } from '@nestjs/common';
import type { Note, Prisma } from '@prisma/client';
import { Page, skipFor } from '../common/pagination';
import { excerpt } from '../common/text';
import { NotebooksService } from '../notebooks/notebooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTagName } from '../tags/tag-name';
import { TagsService } from '../tags/tags.service';
import { CreateNoteDto, ListNotesQuery, UpdateNoteDto } from './dto/note.dto';

export const noteInclude = {
  tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
  notebook: { select: { id: true, name: true, parentId: true } },
} satisfies Prisma.NoteInclude;

type NoteWithRelations = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;

export interface NoteSummary {
  id: string;
  title: string;
  excerpt: string;
  notebookId: string | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NoteView extends Omit<NoteSummary, 'excerpt'> {
  content: string;
  notebook: { id: string; name: string; parentId: string | null } | null;
}

function toSummary(note: NoteWithRelations): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    excerpt: excerpt(note.content),
    notebookId: note.notebookId,
    tags: note.tags.map((noteTag) => noteTag.tag.name),
    pinned: note.pinned,
    favorite: note.favorite,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function toView(note: NoteWithRelations): NoteView {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    notebookId: note.notebookId,
    notebook: note.notebook,
    tags: note.tags.map((noteTag) => noteTag.tag.name),
    pinned: note.pinned,
    favorite: note.favorite,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export const DEFAULT_TITLE = 'Untitled';

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notebooks: NotebooksService,
    private readonly tags: TagsService,
  ) {}

  async list(userId: string, query: ListNotesQuery): Promise<Page<NoteSummary>> {
    const where: Prisma.NoteWhereInput = { userId };

    if (query.notebookId === 'none') {
      where.notebookId = null;
    } else if (query.notebookId) {
      // A top-level notebook shows the notes of the notebooks inside it too.
      where.notebookId = { in: await this.notebooks.idsWithChildren(userId, query.notebookId) };
    }
    if (query.tag) {
      where.tags = { some: { tag: { name: normalizeTagName(query.tag) ?? query.tag } } };
    }
    if (query.pinned !== undefined) where.pinned = query.pinned;
    if (query.favorite !== undefined) where.favorite = query.favorite;

    const order = query.order ?? (query.sort === 'title' ? 'asc' : 'desc');
    const sortField = { updated: 'updatedAt', created: 'createdAt', title: 'title' } as const;
    const orderBy: Prisma.NoteOrderByWithRelationInput[] = [
      // Pinned notes stay at the top whatever the sort.
      { pinned: 'desc' },
      { [sortField[query.sort]]: order },
      { id: 'asc' },
    ];

    const [notes, total] = await this.prisma.$transaction([
      this.prisma.note.findMany({
        where,
        orderBy,
        skip: skipFor(query),
        take: query.pageSize,
        include: noteInclude,
      }),
      this.prisma.note.count({ where }),
    ]);
    return { items: notes.map(toSummary), total, page: query.page, pageSize: query.pageSize };
  }

  async get(userId: string, id: string): Promise<NoteView> {
    const note = await this.prisma.note.findFirst({ where: { id, userId }, include: noteInclude });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return toView(note);
  }

  async create(userId: string, dto: CreateNoteDto): Promise<NoteView> {
    if (dto.notebookId) {
      await this.notebooks.findOwned(userId, dto.notebookId);
    }
    const content = dto.content ?? '';
    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          userId,
          title: dto.title || DEFAULT_TITLE,
          content,
          notebookId: dto.notebookId ?? null,
          pinned: dto.pinned ?? false,
          favorite: dto.favorite ?? false,
        },
      });
      if (dto.tags?.length) {
        await this.tags.setNoteTags(tx, userId, created.id, dto.tags);
      }
      return tx.note.findUniqueOrThrow({ where: { id: created.id }, include: noteInclude });
    });
    return toView(note);
  }

  async update(userId: string, id: string, dto: UpdateNoteDto): Promise<NoteView> {
    const note = await this.findOwned(userId, id);
    if (dto.notebookId) {
      await this.notebooks.findOwned(userId, dto.notebookId);
    }

    const title = dto.title === undefined ? note.title : dto.title || DEFAULT_TITLE;
    const content = dto.content ?? note.content;
    const textChanged = title !== note.title || content !== note.content;
    const notebookChanged = dto.notebookId !== undefined && dto.notebookId !== note.notebookId;

    const updated = await this.prisma.$transaction(async (tx) => {
      const tagsChanged = dto.tags !== undefined;
      if (dto.tags !== undefined) {
        await this.tags.setNoteTags(tx, userId, id, dto.tags);
      }

      const data: Prisma.NoteUpdateInput = { title, content };
      if (dto.notebookId !== undefined) {
        data.notebook = dto.notebookId ? { connect: { id: dto.notebookId } } : { disconnect: true };
      }
      if (dto.pinned !== undefined) data.pinned = dto.pinned;
      if (dto.favorite !== undefined) data.favorite = dto.favorite;
      // Pinning or favouriting is not an edit.
      if (textChanged || notebookChanged || tagsChanged) data.updatedAt = new Date();

      return tx.note.update({ where: { id }, data, include: noteInclude });
    });
    return toView(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.prisma.note.delete({ where: { id } });
  }

  async findOwned(userId: string, id: string): Promise<Note> {
    const note = await this.prisma.note.findFirst({ where: { id, userId } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }
}
