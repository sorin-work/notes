import { api, json } from './client';
import type { AuthResult, User } from './types';

export const login = (email: string, password: string) =>
  api<AuthResult>('/auth/login', json('POST', { email, password }));

export const register = (name: string, email: string, password: string) =>
  api<AuthResult>('/auth/register', json('POST', { name, email, password }));

export const me = () => api<User>('/auth/me');

/** The current password is only needed when the email changes. */
export const updateProfile = (changes: { name?: string; email?: string; currentPassword?: string }) =>
  api<User>('/auth/me', json('PATCH', changes));

/** Signs out every other session. The answer holds a new token for this one. */
export const changePassword = (currentPassword: string, newPassword: string) =>
  api<AuthResult>('/auth/password', json('PATCH', { currentPassword, newPassword }));

/** Ends every session of the account, including the one asking. */
export const logoutEverywhere = () => api<void>('/auth/logout-all', json('POST'));

export const deleteAccount = (password: string) => api<void>('/auth/me', json('DELETE', { password }));

/** False when the server has no SMTP settings, and then the two calls below answer 404. */
export const passwordResetEnabled = () =>
  api<{ enabled: boolean }>('/auth/password-reset').then((status) => status.enabled);

/** The answer is the same whether or not the address has an account. */
export const requestPasswordReset = (email: string) => api<void>('/auth/password-reset', json('POST', { email }));

/** `token` comes from the link in the mail. Ends every session of the account. */
export const resetPassword = (token: string, password: string) =>
  api<void>('/auth/password-reset/confirm', json('POST', { token, password }));
