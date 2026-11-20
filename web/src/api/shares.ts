import { api, json } from './client';
import type { Share, SharedNote, SharedNotebook, ShareOptions, ShareSubject } from './types';

const pathOf = (subject: ShareSubject) =>
  'noteId' in subject ? `/notes/${subject.noteId}/share` : `/notebooks/${subject.notebookId}/share`;

export const getShare = (subject: ShareSubject) => api<{ share: Share | null }>(pathOf(subject));

export const createShare = (subject: ShareSubject) => api<Share>(pathOf(subject), { method: 'POST' });

export const updateShare = (subject: ShareSubject, options: ShareOptions) =>
  api<Share>(pathOf(subject), json('PATCH', options));

export const revokeShare = (subject: ShareSubject) => api<void>(pathOf(subject), { method: 'DELETE' });

export const shareUrl = (token: string) => `${window.location.origin}/s/${token}`;

/**
 * Proof of the right password, per link, as the API hands it out. It is
 * kept here, in memory, and nowhere else: reloading the page asks for the
 * password again.
 */
const access = new Map<string, string>();

/** For tests, which share this module between cases. */
export const forgetShareAccess = () => access.clear();

function asReader(token: string): RequestInit {
  const proof = access.get(token);
  return proof ? { headers: { 'X-Share-Access': proof } } : {};
}

const publicPath = (token: string, noteId?: string) =>
  `/public/notes/${encodeURIComponent(token)}${noteId ? `/${encodeURIComponent(noteId)}` : ''}`;

/**
 * What a share link shows: a note, or the index of a notebook. Answers 403
 * when the link asks for a password, 404 when it is gone or has run out.
 */
export const getShared = (token: string) => api<SharedNote | SharedNotebook>(publicPath(token), asReader(token));

/** One note of a shared notebook. */
export const getSharedNoteIn = (token: string, noteId: string) =>
  api<SharedNote>(publicPath(token, noteId), asReader(token));

/**
 * For a link with a password. The password goes in the body, so that it is
 * in no address, history or log. What comes back also opens the notes of a
 * shared notebook, for as long as this page lives.
 */
export async function unlockShared(token: string, password: string): Promise<SharedNote | SharedNotebook> {
  const { access: proof, ...content } = await api<(SharedNote | SharedNotebook) & { access?: string }>(
    publicPath(token),
    json('POST', { password }),
  );
  if (proof) access.set(token, proof);
  return content;
}
