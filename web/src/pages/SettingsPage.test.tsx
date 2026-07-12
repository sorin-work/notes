import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
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
});
