import { api, json, withQuery } from './client';
import type { Note, NoteChanges, NoteSummary, Page } from './types';

export interface NoteFilters {
  notebookId?: string;
  tag?: string;
  pinned?: boolean;
  favorite?: boolean;
  page?: number;
  pageSize?: number;
}

export const listNotes = (filters: NoteFilters = {}) => api<Page<NoteSummary>>(withQuery('/notes', { ...filters }));

export const getNote = (id: string) => api<Note>(`/notes/${id}`);

export const createNote = (note: NoteChanges = {}) => api<Note>('/notes', json('POST', note));

export const updateNote = (id: string, changes: NoteChanges) => api<Note>(`/notes/${id}`, json('PATCH', changes));
