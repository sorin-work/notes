import type { Prisma } from '@prisma/client';
import { excerpt } from '../common/text';

/**
 * A notebook with the notebooks it is inside, each with its share link, as
 * far up as notebooks nest: four levels, so a notebook has three above it
 * at most (MAX_NOTEBOOK_DEPTH in the notebooks service, which this file
 * cannot import without a loop).
 */
const shareOf = { select: { expiresAt: true } } as const;
export const notebookShareSelect = {
  id: true,
  name: true,
  share: shareOf,
  parent: {
    select: {
      id: true,
      name: true,
      share: shareOf,
      parent: { select: { id: true, name: true, share: shareOf } },
    },
  },
} satisfies Prisma.NotebookSelect;

export const noteInclude = {
  tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
  notebook: {
    select: {
      id: true,
      name: true,
      parentId: true,
      share: { select: { expiresAt: true } },
      parent: { select: notebookShareSelect },
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

/** A notebook, its share link and the notebooks it is inside, nearest first. */
export interface ShareChain {
  id: string;
  name: string;
  share: { expiresAt: Date | null } | null;
  parent?: ShareChain | null;
}

/**
 * The notebook through whose link something is public: the notebook itself,
 * or the nearest notebook it is inside, at any depth. A notebook link covers
 * everything inside it.
 */
export function sharedThrough(notebook: ShareChain | null | undefined, now = new Date()): SharedThrough | null {
  for (let at = notebook; at; at = at.parent) {
    if (live(at.share, now)) return { id: at.id, name: at.name };
  }
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
