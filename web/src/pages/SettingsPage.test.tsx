import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getToken, setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { SettingsPage } from './SettingsPage';

/** What the page asks for when it opens. */
const loaded = {
  'GET /api/auth/me': { body: user },
  'GET /api/tags': { body: [] },
  'GET /api/auth/tokens': { body: [] },
};

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
      ...loaded,
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
    const calls = mockFetch({ ...loaded });
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
      ...loaded,
      'PATCH /api/auth/password': { body: { token: 'tok-2', user } },
    });
    renderSettings();

    await userEvent.type(screen.getByLabelText('Current password'), 'old-password');
    await userEvent.type(screen.getByLabelText('New password'), 'new-password');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    expect(getToken()).toBe('tok-2');
    expect(await screen.findByText('The account has no API tokens.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke all' })).not.toBeInTheDocument();
  });

  it('says after a password change how many API tokens still work, and revokes them all on one click', async () => {
    let revoked = false;
    const token = (id: string, name: string) => ({
      id,
      name,
      readOnly: false,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    });
    const calls = mockFetch({
      ...loaded,
      'GET /api/auth/tokens': () => ({
        body: revoked ? [] : [token('t1', 'backup script'), token('t2', 'old laptop')],
      }),
      'PATCH /api/auth/password': { body: { token: 'tok-2', user } },
      'DELETE /api/auth/tokens': () => {
        revoked = true;
        return { body: { revoked: 2 } };
      },
    });
    renderSettings();

    await userEvent.type(screen.getByLabelText('Current password'), 'old-password');
    await userEvent.type(screen.getByLabelText('New password'), 'new-password');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'new-password');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));

    // "All signed out" would not be the whole truth: the tokens are kept, and said to be.
    expect(await screen.findByText(/2 API tokens still work\./)).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Revoke all' }));

    expect(await screen.findByText(/All API tokens are revoked/)).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/auth/tokens']);
    expect(await screen.findByText('No tokens yet.')).toBeInTheDocument();
  });

  it('saves a new name without asking for the password', async () => {
    const calls = mockFetch({
      ...loaded,
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
      ...loaded,
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
      ...loaded,
      'POST /api/auth/logout-all': { status: 204 },
    });
    renderSettings();

    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() => expect(getToken()).toBeNull());
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/auth/logout-all')).toBe(true);
  });

  it('deletes the account after asking for the password, and offers the export first', async () => {
    const calls = mockFetch({
      ...loaded,
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

  it('shows a new API token once, with the name and the read-only choice sent along', async () => {
    const token = {
      id: 't1',
      name: 'backup script',
      readOnly: true,
      lastUsedAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    let created = false;
    const calls = mockFetch({
      ...loaded,
      'GET /api/auth/tokens': () => ({ body: created ? [token] : [] }),
      'POST /api/auth/tokens': () => {
        created = true;
        return { status: 201, body: { ...token, token: 'nt_secret-value' } };
      },
    });
    renderSettings();

    expect(await screen.findByText('No tokens yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Token name'), 'backup script');
    await userEvent.click(screen.getByLabelText('Read-only'));
    await userEvent.type(screen.getByLabelText('Password, to create the token'), 'demo-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByLabelText('New API token')).toHaveValue('nt_secret-value');
    expect(screen.getByText(/Copy it now, it is not shown again/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      name: 'backup script',
      readOnly: true,
      currentPassword: 'demo-password',
    });
    expect(await screen.findByText(/read-only · made/)).toHaveTextContent('never used');
    expect(screen.getByLabelText('Token name')).toHaveValue('');
    expect(screen.getByLabelText('Password, to create the token')).toHaveValue('');
  });

  it('revokes an API token after asking', async () => {
    const calls = mockFetch({
      ...loaded,
      'GET /api/auth/tokens': {
        body: [
          {
            id: 't1',
            name: 'old laptop',
            readOnly: false,
            lastUsedAt: '2026-01-02T00:00:00Z',
            createdAt: '2026-01-01T00:00:00Z',
          },
        ],
      },
      'DELETE /api/auth/tokens/t1': { status: 204 },
    });
    renderSettings();

    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke token' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
