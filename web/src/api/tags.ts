import { api } from './client';
import type { Tag } from './types';

export const listTags = () => api<Tag[]>('/tags');
