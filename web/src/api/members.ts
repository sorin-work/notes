import { api, json } from './client';

export type Role = 'read' | 'edit';

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  since: string;
}

export interface SentInvite {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

export interface ReceivedInvite {
  id: string;
  notebook: { id: string; name: string };
  from: { name: string };
  role: Role;
  expiresAt: string;
}

export interface Members {
  owner: { name: string };
  members: Member[];
  /** Only for the owner. */
  invites: SentInvite[];
}

const base = (notebookId: string) => `/notebooks/${notebookId}/members`;

export const listMembers = (notebookId: string) => api<Members>(base(notebookId));

export const inviteMember = (notebookId: string, email: string, role: Role) =>
  api<SentInvite>(`${base(notebookId)}/invites`, json('POST', { email, role }));

export const revokeInvite = (notebookId: string, inviteId: string) =>
  api<void>(`${base(notebookId)}/invites/${inviteId}`, { method: 'DELETE' });

export const changeRole = (notebookId: string, userId: string, role: Role) =>
  api<void>(`${base(notebookId)}/${userId}`, json('PATCH', { role }));

/** The owner removing someone, or, with your own id, leaving the notebook. */
export const removeMember = (notebookId: string, userId: string) =>
  api<void>(`${base(notebookId)}/${userId}`, { method: 'DELETE' });

export const receivedInvites = () => api<ReceivedInvite[]>('/invites');

export const acceptInvite = (id: string) => api<{ notebookId: string }>(`/invites/${id}/accept`, { method: 'POST' });

export const acceptInviteByToken = (token: string) =>
  api<{ notebookId: string }>('/invites/accept', json('POST', { token }));

export const declineInvite = (id: string) => api<void>(`/invites/${id}`, { method: 'DELETE' });
