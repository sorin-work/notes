import { api, json } from './client';
import type { ApiToken, CreatedApiToken } from './types';

export const listApiTokens = () => api<ApiToken[]>('/auth/tokens');

/**
 * Needs the password: a token outlives every login. The answer is the only
 * time the token itself comes back.
 */
export const createApiToken = (name: string, readOnly: boolean, currentPassword: string) =>
  api<CreatedApiToken>('/auth/tokens', json('POST', { name, readOnly, currentPassword }));

/** Ends every token of the account. */
export const revokeAllApiTokens = () => api<{ revoked: number }>('/auth/tokens', { method: 'DELETE' });

export const revokeApiToken = (id: string) => api<void>(`/auth/tokens/${id}`, { method: 'DELETE' });
