import { api, json } from './client';
import type { Notebook } from './types';

export const listNotebooks = () => api<Notebook[]>('/notebooks');

export const createNotebook = (name: string, parentId: string | null = null) =>
  api<Notebook>('/notebooks', json('POST', { name, parentId }));

export const updateNotebook = (id: string, changes: { name?: string; parentId?: string | null }) =>
  api<Notebook>(`/notebooks/${id}`, json('PATCH', changes));

export const deleteNotebook = (id: string) => api<{ trashedNotes: number }>(`/notebooks/${id}`, { method: 'DELETE' });
