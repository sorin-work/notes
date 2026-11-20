import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { getToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { GuestOnly } from '../auth/guards';
import { user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { queueText, unsentOfOthers } from '../lib/outbox';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';

function renderAuth(route: string) {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestOnly>
              <LoginPage />
            </GuestOnly>
          }
        />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/notes" element={<div>Your notes</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

describe('LoginPage', () => {
  it('asks before signing in deletes the unsent offline changes of another account', async () => {
    mockFetch({ 'POST /api/auth/login': { body: { token: 'tok-1', user } } });
    await queueText('someone-else', 'n9', { title: 'Theirs', content: 'Typed on the train.' }, 1);
    renderAuth('/login');
    await userEvent.type(screen.getByLabelText('Email'), 'demo@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'demo-password');

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete another account’s unsent changes?' });
    expect(dialog).toHaveTextContent('1 change that another account made without a connection');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(getToken()).toBeNull();
    expect(await unsentOfOthers(user.id)).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in and delete them' }));
    expect(await screen.findByText('Your notes')).toBeInTheDocument();
    await waitFor(async () => expect(await unsentOfOthers(user.id)).toBe(0));
  });

  it('signs in and opens the notes', async () => {
    const calls = mockFetch({ 'POST /api/auth/login': { body: { token: 'tok-1', user } } });
    renderAuth('/login');

    await userEvent.type(screen.getByLabelText('Email'), 'demo@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'demo-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Your notes')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      email: 'demo@example.com',
      password: 'demo-password',
    });
    expect(getToken()).toBe('tok-1');
  });

  it('offers "Forgot password?" only when the server can send mail', async () => {
    mockFetch({ 'GET /api/auth/password-reset': { body: { enabled: true } } });
    const first = renderAuth('/login');
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    first.unmount();

    const calls = mockFetch({ 'GET /api/auth/password-reset': { body: { enabled: false } } });
    renderAuth('/login');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Forgot password?' })).not.toBeInTheDocument();
  });

  it('shows the error for wrong credentials', async () => {
    mockFetch({
      'POST /api/auth/login': { status: 401, body: { message: 'Email or password is incorrect', statusCode: 401 } },
    });
    renderAuth('/login');

    await userEvent.type(screen.getByLabelText('Email'), 'demo@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
    expect(getToken()).toBeNull();
  });
});

describe('RegisterPage', () => {
  it('lists every validation message from the API', async () => {
    mockFetch({
      'POST /api/auth/register': {
        status: 400,
        body: { message: ['email must be a valid email address', 'name is required'], statusCode: 400 },
      },
    });
    renderAuth('/register');

    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'long-enough');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('email must be a valid email address');
    expect(alert).toHaveTextContent('name is required');
  });

  it('creates the account and signs in', async () => {
    const calls = mockFetch({ 'POST /api/auth/register': { status: 201, body: { token: 'tok-2', user } } });
    renderAuth('/register');

    await userEvent.type(screen.getByLabelText('Name'), 'Ada');
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'long-enough');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Your notes')).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ name: 'Ada', email: 'ada@example.com', password: 'long-enough' });
  });
});

describe('the sign-in and sign-up pages', () => {
  it('pass the axe checks', async () => {
    mockFetch({});
    const login = renderAuth('/login');
    await expectNoAxeViolations();
    login.unmount();

    renderAuth('/register');
    await expectNoAxeViolations();
  });
});
