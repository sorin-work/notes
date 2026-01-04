import { api } from './client';
import type { TrashedNote } from './types';

export const listTrash = () => api<TrashedNote[]>('/trash');

export const restoreNote = (id: string) => api<void>(`/trash/${id}/restore`, { method: 'POST' });

export const deleteForever = (id: string) => api<void>(`/trash/${id}`, { method: 'DELETE' });

export const emptyTrash = () => api<{ deleted: number }>('/trash', { method: 'DELETE' });
