import type { Prisma } from '@prisma/client';
import { excerpt } from '../common/text';

export const noteInclude = {
  tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
  notebook: { select: { id: true, name: true, parentId: true } },
  share: { select: { id: true } },
} satisfies Prisma.NoteInclude;

export type NoteWithRelations = Prisma.NoteGetPayload<{ include: typeof noteInclude }>;

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
  shared: boolean;
  deletedAt: Date | null;
}

export function toSummary(note: NoteWithRelations): NoteSummary {
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

export function toView(note: NoteWithRelations): NoteView {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    notebookId: note.notebookId,
    notebook: note.notebook,
    tags: note.tags.map((noteTag) => noteTag.tag.name),
    pinned: note.pinned,
    favorite: note.favorite,
    shared: note.share !== null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
  };
}
