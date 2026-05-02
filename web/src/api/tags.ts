import { api, json } from './client';
import type { Tag } from './types';

export const listTags = () => api<Tag[]>('/tags');

export const renameTag = (id: string, name: string) => api<Tag>(`/tags/${id}`, json('PATCH', { name }));

export const deleteTag = (id: string) => api<void>(`/tags/${id}`, { method: 'DELETE' });
