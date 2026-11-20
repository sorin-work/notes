import { api, json } from './client';
import type { ApiToken, CreatedApiToken } from './types';

export const listApiTokens = () => api<ApiToken[]>('/auth/tokens');

/** The answer is the only time the token itself comes back. */
export const createApiToken = (name: string, readOnly: boolean) =>
  api<CreatedApiToken>('/auth/tokens', json('POST', { name, readOnly }));

export const revokeApiToken = (id: string) => api<void>(`/auth/tokens/${id}`, { method: 'DELETE' });
