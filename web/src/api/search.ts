import { api, withQuery } from './client';
import type { Page, SearchHit } from './types';

export const search = (q: string, page = 1) => api<Page<SearchHit>>(withQuery('/search', { q, page, pageSize: 30 }));
