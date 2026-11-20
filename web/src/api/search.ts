import { api, withQuery } from './client';
import type { Page, SearchHit } from './types';

export interface SearchFilters {
  /** A notebook id, or "none" for notes that are not in a notebook. */
  notebookId?: string | null;
  tag?: string | null;
  page?: number;
}

export const search = (q: string, filters: SearchFilters = {}) =>
  api<Page<SearchHit>>(withQuery('/search', { q, ...filters, pageSize: 30 }));
