import { api, json } from './client';
import type { AuthResult, User } from './types';

export const login = (email: string, password: string) =>
  api<AuthResult>('/auth/login', json('POST', { email, password }));

export const register = (name: string, email: string, password: string) =>
  api<AuthResult>('/auth/register', json('POST', { name, email, password }));

export const me = () => api<User>('/auth/me');

export const changePassword = (currentPassword: string, newPassword: string) =>
  api<void>('/auth/password', json('PATCH', { currentPassword, newPassword }));
