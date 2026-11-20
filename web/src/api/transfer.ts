import { api, download } from './client';
import type { ImportResult, RestoreResult } from './types';

export const exportAll = () => download('/export', 'notes-export.zip');

/**
 * Downloads the full backup through a one-time link that the browser follows
 * itself. That way the file goes to disk as it comes in; a download through
 * fetch would hold all of it in memory first, and a backup can be large.
 */
export async function exportBackup(): Promise<void> {
  const { url } = await api<{ url: string }>('/export/backup/link', { method: 'POST' });
  const link = document.createElement('a');
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Sends the backup file itself as the body, which the API reads as it comes in. */
export function restoreBackup(file: File): Promise<RestoreResult> {
  return api<RestoreResult>('/import/backup', {
    method: 'POST',
    body: file,
    headers: { 'Content-Type': 'application/octet-stream' },
  });
}

export function importFiles(files: File[], { skipExisting = true } = {}): Promise<ImportResult> {
  const body = new FormData();
  for (const file of files) body.append('files', file);
  body.append('skipExisting', String(skipExisting));
  return api<ImportResult>('/import', { method: 'POST', body });
}
