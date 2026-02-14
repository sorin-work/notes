import { api } from './client';
import type { Share, SharedNote } from './types';

export const getShare = (noteId: string) => api<{ share: Share | null }>(`/notes/${noteId}/share`);

export const createShare = (noteId: string) => api<Share>(`/notes/${noteId}/share`, { method: 'POST' });

export const revokeShare = (noteId: string) => api<void>(`/notes/${noteId}/share`, { method: 'DELETE' });

export const getSharedNote = (token: string) => api<SharedNote>(`/public/notes/${encodeURIComponent(token)}`);

export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`;
