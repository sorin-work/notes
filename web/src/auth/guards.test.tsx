import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { getToken, setToken } from '../api/client';
import { user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { AuthProvider } from './AuthContext';
import { RequireAuth } from './guards';

function renderProtected() {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<div>Login page</div>} />
        <Route
          path="/notes"
          element={
            <RequireAuth>
              <div>Secret notes</div>
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>,
    { route: '/notes' },
  );
}

describe('RequireAuth', () => {
  it('sends signed-out visitors to the login page', async () => {
    mockFetch({});
    renderProtected();
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('shows the page once the saved token checks out', async () => {
    setToken('tok');
    mockFetch({ 'GET /api/auth/me': { body: user } });
    renderProtected();
    expect(await screen.findByText('Secret notes')).toBeInTheDocument();
  });

  it('signs out when the saved token has expired', async () => {
    setToken('expired');
    mockFetch({ 'GET /api/auth/me': { status: 401, body: { message: 'Invalid or expired token' } } });
    renderProtected();
    expect(await screen.findByText('Login page')).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});
