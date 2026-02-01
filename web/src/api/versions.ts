import { api } from './client';
import type { Note, Version, VersionSummary } from './types';

export const listVersions = (noteId: string) => api<VersionSummary[]>(`/notes/${noteId}/versions`);

export const getVersion = (noteId: string, versionId: string) => api<Version>(`/notes/${noteId}/versions/${versionId}`);

export const restoreVersion = (noteId: string, versionId: string) =>
  api<Note>(`/notes/${noteId}/versions/${versionId}/restore`, { method: 'POST' });
