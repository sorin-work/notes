import { api } from './client';
import type { Attachment } from './types';

export const listAttachments = (noteId: string) => api<Attachment[]>(`/notes/${noteId}/attachments`);

export function uploadAttachment(noteId: string, file: File): Promise<Attachment> {
  const body = new FormData();
  body.append('file', file);
  return api<Attachment>(`/notes/${noteId}/attachments`, { method: 'POST', body });
}

export const deleteAttachment = (id: string) => api<void>(`/attachments/${id}`, { method: 'DELETE' });

/** What a page shows images and links with: the signed address of each attachment, by id. */
export const attachmentUrls = (attachments: Attachment[] | undefined): Record<string, string> =>
  Object.fromEntries((attachments ?? []).map((attachment) => [attachment.id, attachment.url]));
