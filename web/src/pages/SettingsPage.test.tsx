import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getToken, setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { expectNoAxeViolations } from '../test/axe';
import { user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { SettingsPage } from './SettingsPage';

function renderSettings() {
  setToken('tok');
  return renderWithProviders(
    <AuthProvider>
      <SettingsPage />
    </AuthProvider>,
  );
}

describe('SettingsPage', () => {
  it('imports files and lists the ones it skipped', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/tags': { body: [] },
      'POST /api/import': {
        status: 201,
        body: { imported: 2, notebooksCreated: 1, skipped: [{ file: 'photo.jpg', reason: 'Not a Markdown file' }] },
      },
    });
    renderSettings();

    const file = new File(['# Hello'], 'hello.md', { type: 'text/markdown' });
    await userEvent.upload(screen.getByLabelText('Files to import'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));

    expect(await screen.findByText(/Imported 2 notes and created 1 notebooks/)).toBeInTheDocument();
    expect(screen.getByText('1 files skipped')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toBeInstanceOf(FormData);
  });

  it('checks that the new passwords match before sending them', async () => {
    const calls = mockFetch({ 'GET /api/auth/me': { body: user }, 'GET /api/tags': { body: [] } });
    renderSettings();

    await userEvent.type(screen.getByLabelText('Current password'), 'old-password');
    await userEvent.type(screen.getByLabelText('New password'), 'new-password');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'other-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(screen.getByText('The new passwords do not match.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
  });

  it('keeps this session going with the new token after a password change', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/tags': { body: [] },
      'PATCH /api/auth/password': { body: { token: 'tok-2', user } },
    });
    renderSettings();

    await userEvent.type(screen.getByLabelText('Current password'), 'old-password');
    await userEvent.type(screen.getByLabelText('New password'), 'new-password');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(getToken()).toBe('tok-2');
  });

  it('saves a new name without asking for the password', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/tags': { body: [] },
      'PATCH /api/auth/me': { body: { ...user, name: 'Ada Lovelace' } },
    });
    renderSettings();

    const name = await screen.findByLabelText('Name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.type(name, 'Ada Lovelace');
    expect(screen.queryByLabelText('Password, to confirm the new email')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ name: 'Ada Lovelace', email: user.email });
  });

  it('asks for the password when the email changes', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/tags': { body: [] },
      'PATCH /api/auth/me': { body: { ...user, email: 'ada@example.com' } },
    });
    renderSettings();

    const email = await screen.findByLabelText('Email');
    await userEvent.clear(email);
    await userEvent.type(email, 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password, to confirm the new email'), 'demo-password');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      name: user.name,
      email: 'ada@example.com',
      currentPassword: 'demo-password',
    });
    expect(screen.getByLabelText('Email')).toHaveValue('ada@example.com');
    expect(screen.queryByLabelText('Password, to confirm the new email')).not.toBeInTheDocument();
  });

  it('signs out everywhere, this browser included', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/tags': { body: [] },
      'POST /api/auth/logout-all': { status: 204 },
    });
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => expect(getToken()).toBeNull());
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/auth/logout-all')).toBe(true);
  });

  it('deletes the account after asking for the password, and offers the export first', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/tags': { body: [] },
      'DELETE /api/auth/me': { status: 204 },
    });
    renderSettings();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete account…' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Export all notes' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Delete account' })).toBeDisabled();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await userEvent.type(dialog.getByLabelText('Password'), 'demo-password');
    await userEvent.click(dialog.getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(getToken()).toBeNull());
    expect(calls.find((call) => call.method === 'DELETE')?.body).toEqual({ password: 'demo-password' });
  });

  it('passes the axe checks, with the profile form filled in and the delete dialog open', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/tags': { body: [{ id: 't1', name: 'atlas', noteCount: 2 }] },
    });
    renderSettings();
    expect(await screen.findByDisplayValue(user.email)).toBeInTheDocument();
    await screen.findAllByText(/atlas/);
    await expectNoAxeViolations({ part: true });

    await userEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await expectNoAxeViolations({ part: true });
  });
});
