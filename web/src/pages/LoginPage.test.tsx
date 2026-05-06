import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { getToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { GuestOnly } from '../auth/guards';
import { user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
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
  it('signs in and opens the notes', async () => {
    const calls = mockFetch({ 'POST /api/auth/login': { body: { token: 'tok-1', user } } });
    renderAuth('/login');

    await userEvent.type(screen.getByLabelText('Email'), 'demo@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'demo-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Your notes')).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ email: 'demo@example.com', password: 'demo-password' });
    expect(getToken()).toBe('tok-1');
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
