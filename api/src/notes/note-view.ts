import type { Prisma } from '@prisma/client';
import { excerpt } from '../common/text';

export const noteInclude = {
  tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
  notebook: {
    select: {
      id: true,
      name: true,
      parentId: true,
      share: { select: { expiresAt: true } },
      parent: { select: { id: true, name: true, share: { select: { expiresAt: true } } } },
    },
  },
  share: { select: { id: true } },
} satisfies Prisma.NoteInclude;

/** A notebook whose share link makes what is in it public. */
export interface SharedThrough {
  id: string;
  name: string;
}

/** Whether a share link still lets readers in. One that has run out does not. */
const live = (share: { expiresAt: Date | null } | null, now: Date) =>
  !!share && (share.expiresAt === null || share.expiresAt > now);

/**
 * The notebook through whose link something is public: the notebook itself,
 * or the notebook it is inside. A notebook link covers both levels.
 */
export function sharedThrough(
  notebook: {
    id: string;
    name: string;
    share: { expiresAt: Date | null } | null;
    parent: { id: string; name: string; share: { expiresAt: Date | null } | null } | null;
  } | null,
  now = new Date(),
): SharedThrough | null {
  if (!notebook) return null;
  if (live(notebook.share, now)) return { id: notebook.id, name: notebook.name };
  if (notebook.parent && live(notebook.parent.share, now))
    return { id: notebook.parent.id, name: notebook.parent.name };
  return null;
}

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
  /** Counts the changes to the title and the content. A save names the revision it was based on. */
  revision: number;
  notebook: { id: string; name: string; parentId: string | null } | null;
  /** Whether the note has a share link of its own. */
  shared: boolean;
  /** The shared notebook that makes the note public, if one does. */
  sharedThrough: SharedThrough | null;
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
    revision: note.revision,
    notebookId: note.notebookId,
    notebook: note.notebook && { id: note.notebook.id, name: note.notebook.name, parentId: note.notebook.parentId },
    tags: note.tags.map((noteTag) => noteTag.tag.name),
    pinned: note.pinned,
    favorite: note.favorite,
    shared: note.share !== null,
    sharedThrough: sharedThrough(note.notebook),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    deletedAt: note.deletedAt,
  };
}
