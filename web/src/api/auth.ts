import { api, json } from './client';
import type { AuthResult, Preferences, TwoStepSetup, TwoStepStatus, TwoStepTicket, User } from './types';

/** With two-step sign-in on, the answer is a ticket for `loginWithCode` instead of a token. */
export const login = (email: string, password: string) =>
  api<AuthResult | TwoStepTicket>('/auth/login', json('POST', { email, password }));

/** The second step: the ticket and a code from the app, or a recovery code. A wrong code answers 403. */
export const loginWithCode = (ticket: string, code: string) =>
  api<AuthResult>('/auth/login/code', json('POST', { ticket, code }));

export const twoStepStatus = () => api<TwoStepStatus>('/auth/two-step');

/** A new secret for the app. Codes are not on until `enableTwoStep` gets the first one. */
export const startTwoStep = (currentPassword: string) =>
  api<TwoStepSetup>('/auth/two-step/setup', json('POST', { currentPassword }));

/** Turns codes on. Every other session ends, so the answer holds a new token, and the recovery codes. */
export const enableTwoStep = (code: string) =>
  api<AuthResult & { recoveryCodes: string[] }>('/auth/two-step/enable', json('POST', { code }));

export const disableTwoStep = (currentPassword: string, code: string) =>
  api<void>('/auth/two-step/disable', json('POST', { currentPassword, code }));

export const newRecoveryCodes = (currentPassword: string, code: string) =>
  api<{ recoveryCodes: string[] }>('/auth/two-step/recovery-codes', json('POST', { currentPassword, code }));

/** `token` comes from the link mailed to the new address. */
export const confirmEmail = (token: string) => api<void>('/auth/email/confirm', json('POST', { token }));

export const register = (name: string, email: string, password: string) =>
  api<AuthResult>('/auth/register', json('POST', { name, email, password }));

export const me = () => api<User>('/auth/me');

/** The current password is only needed when the email changes. */
export const updateProfile = (changes: { name?: string; email?: string; currentPassword?: string }) =>
  api<User>('/auth/me', json('PATCH', changes));

/** Changes the daily note choices that are sent and leaves the others. The answer is all the preferences. */
export const updatePreferences = (dailyNotes: Partial<Preferences['dailyNotes']>) =>
  api<Preferences>('/auth/preferences', json('PATCH', { dailyNotes }));

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

/** `token` comes from the link in the mail. Ends every login of the account and revokes its API tokens. */
export const resetPassword = (token: string, password: string) =>
  api<void>('/auth/password-reset/confirm', json('POST', { token, password }));
