import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { getToken, setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { expectNoAxeViolations } from '../test/axe';
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
  it('sends the token from the link with the new password, then signs this browser out', async () => {
    setToken('tok');
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'POST /api/auth/password-reset/confirm': { status: 204 },
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
    expect(getToken()).toBeNull();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
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

describe('the password reset pages', () => {
  /** The pages as they are in the app, with nothing of the test around them. */
  function renderAlone(route: string) {
    return renderWithProviders(
      <AuthProvider>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </AuthProvider>,
      { route },
    );
  }

  it('pass the axe checks, and a message takes the focus the form had', async () => {
    mockFetch({ 'POST /api/auth/password-reset': { status: 204 } });
    const forgot = renderAlone('/forgot-password');
    expect(screen.getByLabelText('Email')).toHaveFocus();
    await expectNoAxeViolations();

    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send the link' }));
    expect(await screen.findByRole('heading', { name: 'Check your mail' })).toHaveFocus();
    await expectNoAxeViolations();
    forgot.unmount();

    const reset = renderAlone('/reset-password#token=abc-123');
    expect(screen.getByLabelText('New password')).toHaveFocus();
    await expectNoAxeViolations();
    reset.unmount();

    renderAlone('/reset-password');
    expect(screen.getByRole('heading', { name: 'This link is not complete' })).toHaveFocus();
    await expectNoAxeViolations();
  });
});
