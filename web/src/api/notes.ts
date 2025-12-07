import { api, withQuery } from './client';
import type { NoteSummary, Page } from './types';

export interface NoteFilters {
  notebookId?: string;
  tag?: string;
  pinned?: boolean;
  favorite?: boolean;
  page?: number;
  pageSize?: number;
}

export const listNotes = (filters: NoteFilters = {}) => api<Page<NoteSummary>>(withQuery('/notes', { ...filters }));
