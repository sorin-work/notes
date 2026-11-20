import { api, download, json, withQuery } from './client';
import type { Backlink, MentionPage, Note, NoteChanges, NoteSummary, OutgoingLink, Page } from './types';

export type NoteSort = 'updated' | 'created' | 'title';

export interface NoteFilters {
  notebookId?: string;
  tag?: string;
  pinned?: boolean;
  favorite?: boolean;
  /** Only notes with no links in or out. */
  orphans?: boolean;
  sort?: NoteSort;
  page?: number;
  pageSize?: number;
}

export const listNotes = (filters: NoteFilters = {}) => api<Page<NoteSummary>>(withQuery('/notes', { ...filters }));

export const getNote = (id: string) => api<Note>(`/notes/${id}`);

export const createNote = (note: NoteChanges = {}) => api<Note>('/notes', json('POST', note));

export const updateNote = (id: string, changes: NoteChanges) => api<Note>(`/notes/${id}`, json('PATCH', changes));

export const trashNote = (id: string) => api<void>(`/notes/${id}`, { method: 'DELETE' });

export const backlinks = (id: string) => api<Backlink[]>(`/notes/${id}/backlinks`);

export const outgoingLinks = (id: string) => api<OutgoingLink[]>(`/notes/${id}/links`);

/** Notes that mention this note's title without linking to it. */
export const mentions = (id: string, page: number, pageSize: number) =>
  api<MentionPage>(withQuery(`/notes/${id}/mentions`, { page, pageSize }));

/** Wraps the first such mention in the note `sourceId` in [[ ]]. */
export const linkMention = (id: string, sourceId: string) =>
  api<void>(`/notes/${id}/mentions/${sourceId}/link`, { method: 'POST' });

export const noteTitles = (q: string, limit = 8) =>
  api<{ id: string; title: string }[]>(withQuery('/notes/titles', { q, limit }));

export const resolveTitle = (title: string) =>
  api<{ id: string; title: string }>(withQuery('/notes/resolve', { title }));

export const exportNote = (id: string, title: string) => download(`/notes/${id}/export`, `${title}.md`);
