import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { getToken, setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { ForgotPasswordPage } from './ForgotPasswordPage';
import { ResetPasswordPage } from './ResetPasswordPage';

/** Shows what is in the address bar, to see the token leave it. */
function AddressBar() {
  const location = useLocation();
  return <span aria-label="address">{location.pathname + location.search + location.hash}</span>;
}

function renderAt(route: string) {
  return renderWithProviders(
    <AuthProvider>
      <AddressBar />
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('ForgotPasswordPage', () => {
  it('asks for a link and says the same whoever the address belongs to', async () => {
    const calls = mockFetch({ 'POST /api/auth/password-reset': { status: 204 } });
    renderAt('/forgot-password');

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));

    expect(await screen.findByRole('status')).toHaveTextContent('If ada@example.com has an account here');
    expect(calls[0]).toMatchObject({ method: 'POST', body: { email: 'ada@example.com' } });
  });

  it('shows why when the server cannot send mail', async () => {
    mockFetch({
      'POST /api/auth/password-reset': {
        status: 404,
        body: { message: 'Password reset by email is not set up on this server', statusCode: 404 },
      },
    });
    renderAt('/forgot-password');

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not set up on this server');
  });
});

describe('ResetPasswordPage', () => {
  it('sends the token from the link with the new password, then is signed in with the new login', async () => {
    setToken('tok');
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/auth/tokens': { body: [] },
      'POST /api/auth/password-reset/confirm': { body: { token: 'tok-new', user } },
    });
    renderAt('/reset-password#token=abc-123');

    // The token is read from the fragment and then taken out of the address bar.
    await waitFor(() => expect(screen.getByLabelText('address')).toHaveTextContent(/^\/reset-password$/));
    await userEvent.type(screen.getByLabelText('New password'), 'battery-staple');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'battery-stable');
    await userEvent.click(screen.getByRole('button', { name: 'Set the new password' }));
    expect(screen.getByText('The new passwords do not match.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await userEvent.clear(screen.getByLabelText('Repeat new password'));
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'battery-staple');
    await userEvent.click(screen.getByRole('button', { name: 'Set the new password' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Password changed');
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      token: 'abc-123',
      password: 'battery-staple',
    });
    // The old login died with the reset. The answer brought a new one.
    expect(getToken()).toBe('tok-new');
    expect(screen.getByRole('link', { name: 'Open your notes' })).toHaveAttribute('href', '/notes');
    expect(screen.queryByRole('button', { name: 'Revoke all tokens' })).not.toBeInTheDocument();
  });

  it('shows the API tokens that outlived the reset, with one click to revoke them', async () => {
    const calls = mockFetch({
      'GET /api/auth/tokens': {
        body: [{ id: 't1', name: 'cron job', readOnly: false, lastUsedAt: null, createdAt: '2026-01-01T00:00:00Z' }],
      },
      'POST /api/auth/password-reset/confirm': { body: { token: 'tok-new', user } },
      'DELETE /api/auth/tokens': { body: { revoked: 1 } },
    });
    renderAt('/reset-password#token=abc-123');

    await userEvent.type(screen.getByLabelText('New password'), 'battery-staple');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'battery-staple');
    await userEvent.click(screen.getByRole('button', { name: 'Set the new password' }));

    const notice = within(await screen.findByRole('group', { name: 'API tokens that still work' }));
    expect(notice.getByText('cron job')).toBeInTheDocument();
    await userEvent.click(notice.getByRole('button', { name: 'Revoke all tokens' }));

    expect(await screen.findByText(/All API tokens are revoked/)).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/auth/tokens')).toBe(true);
  });

  it('says so when the link has been used or has run out', async () => {
    mockFetch({
      'POST /api/auth/password-reset/confirm': {
        status: 400,
        body: { message: 'This link does not work any more. Ask for a new one.', statusCode: 400 },
      },
    });
    renderAt('/reset-password#token=old');

    await userEvent.type(screen.getByLabelText('New password'), 'battery-staple');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'battery-staple');
    await userEvent.click(screen.getByRole('button', { name: 'Set the new password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This link does not work any more');
    expect(screen.getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('does not show the form without a token', () => {
    mockFetch({});
    renderAt('/reset-password');
    expect(screen.getByText('This link is not complete')).toBeInTheDocument();
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
  });

  it('does not take a token from the query string, where a server would log it', () => {
    mockFetch({});
    renderAt('/reset-password?token=abc-123');
    expect(screen.getByText('This link is not complete')).toBeInTheDocument();
  });
});
