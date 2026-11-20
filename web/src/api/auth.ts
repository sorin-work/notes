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
