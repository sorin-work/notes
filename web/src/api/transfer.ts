import { api, download } from './client';
import type { ImportResult, RestoreResult } from './types';

export const exportAll = () => download('/export', 'notes-export.zip');

export const exportBackup = () => download('/export/backup', 'notes-backup.json');

export function restoreBackup(file: File): Promise<RestoreResult> {
  const body = new FormData();
  body.append('file', file);
  return api<RestoreResult>('/import/backup', { method: 'POST', body });
}

export function importFiles(files: File[], { skipExisting = true } = {}): Promise<ImportResult> {
  const body = new FormData();
  for (const file of files) body.append('files', file);
  body.append('skipExisting', String(skipExisting));
  return api<ImportResult>('/import', { method: 'POST', body });
}
