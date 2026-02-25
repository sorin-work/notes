import { api, download } from './client';
import type { ImportResult } from './types';

export const exportAll = () => download('/export', 'notes-export.zip');

export function importFiles(files: File[]): Promise<ImportResult> {
  const body = new FormData();
  for (const file of files) body.append('files', file);
  return api<ImportResult>('/import', { method: 'POST', body });
}
