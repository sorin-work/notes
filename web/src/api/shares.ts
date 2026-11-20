import { api, json } from './client';
import type { Share, SharedNote, ShareOptions } from './types';

export const getShare = (noteId: string) => api<{ share: Share | null }>(`/notes/${noteId}/share`);

export const createShare = (noteId: string) => api<Share>(`/notes/${noteId}/share`, { method: 'POST' });

export const revokeShare = (noteId: string) => api<void>(`/notes/${noteId}/share`, { method: 'DELETE' });

export const updateShare = (noteId: string, options: ShareOptions) =>
  api<Share>(`/notes/${noteId}/share`, json('PATCH', options));

/** Answers 403 when the link asks for a password, 404 when it is gone or has run out. */
export const getSharedNote = (token: string) => api<SharedNote>(`/public/notes/${encodeURIComponent(token)}`);

/** For a link with a password. The password goes in the body, so that it is in no address, history or log. */
export const unlockSharedNote = (token: string, password: string) =>
  api<SharedNote>(`/public/notes/${encodeURIComponent(token)}`, json('POST', { password }));

export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`;
