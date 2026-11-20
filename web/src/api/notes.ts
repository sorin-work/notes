import { api, ApiError, download, json, withQuery } from './client';
import type { Backlink, Note, NoteChanges, NoteSummary, OutgoingLink, Page } from './types';

export type NoteSort = 'updated' | 'created' | 'title';

export interface NoteFilters {
  notebookId?: string;
  tag?: string;
  pinned?: boolean;
  favorite?: boolean;
  /** The templates, which no other list shows. */
  templates?: boolean;
  sort?: NoteSort;
  page?: number;
  pageSize?: number;
}

export const listNotes = (filters: NoteFilters = {}) => api<Page<NoteSummary>>(withQuery('/notes', { ...filters }));

export const getNote = (id: string) => api<Note>(`/notes/${id}`);

export const createNote = (note: NoteChanges = {}) => api<Note>('/notes', json('POST', note));

export const updateNote = (id: string, changes: NoteChanges) => api<Note>(`/notes/${id}`, json('PATCH', changes));

/**
 * When a save was refused because the note changed since the revision it
 * named, the note as it is now on the server. Null for every other error.
 */
export function staleNote(error: unknown): Note | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body as { code?: string; note?: Note } | null;
  return body?.code === 'stale_revision' && body.note ? body.note : null;
}

export const trashNote = (id: string) => api<void>(`/notes/${id}`, { method: 'DELETE' });

/**
 * The daily note of a day: the one there is, or a new one made as the
 * preferences say. The day and its title come from here, see lib/days.
 */
export const openDailyNote = (today: { date: string; placeholders: { date: string; time: string } }) =>
  api<Note>('/notes/daily', json('POST', today));

/** A copy of the note with its text, tags and notebook, and nothing else of it. */
export const duplicateNote = (id: string) => api<Note>(`/notes/${id}/duplicate`, { method: 'POST' });

export const backlinks = (id: string) => api<Backlink[]>(`/notes/${id}/backlinks`);

export const outgoingLinks = (id: string) => api<OutgoingLink[]>(`/notes/${id}/links`);

export const noteTitles = (q: string, limit = 8) =>
  api<{ id: string; title: string }[]>(withQuery('/notes/titles', { q, limit }));

export const resolveTitle = (title: string) =>
  api<{ id: string; title: string }>(withQuery('/notes/resolve', { title }));

/** How many notes still link to `from`, a title the note had before it was renamed, and now lead nowhere. */
export const orphanedLinkCount = (id: string, from: string) =>
  api<{ count: number }>(withQuery(`/notes/${id}/rename-links`, { from }));

export interface RenamedLinks {
  updated: number;
  /** Notes that still link to the old title: edited meanwhile, too long, or a link that is not rewritten. */
  skipped: number;
  /** The title the links point at now. */
  title: string;
  /** The notes whose text changed on the server. */
  noteIds: string[];
}

/** Points those links at the title the note has now. */
export const renameLinks = (id: string, from: string) =>
  api<RenamedLinks>(`/notes/${id}/rename-links`, json('POST', { from }));

export const exportNote = (id: string, title: string) => download(`/notes/${id}/export`, `${title}.md`);
