import { useQuery } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api, getToken, setToken } from '../api/client';
import { getNote } from '../api/notes';
import { user } from '../test/fixtures';
import { keptUsers, seedOfflineCache } from '../test/offline';
import { mockFetch, renderWithProviders } from '../test/render';
import { registerUnsavedWork } from '../lib/unsavedWork';
import { AuthProvider, page, useAuth } from './AuthContext';

/** A login token the way the API makes them: only the user id in it matters here. */
const tokenFor = (id: string) => `header.${btoa(JSON.stringify({ sub: id, ver: 0 }))}.signature`;
const other = { ...user, id: 'u2', email: 'other@example.com', name: 'Other User' };

function Probe() {
  const { status, user: current, logout, login } = useAuth();
  const kept = useQuery({ queryKey: ['note', 'n1'], queryFn: () => getNote('n1'), enabled: status === 'signed-in' });
  return (
    <div>
      <p>status: {status}</p>
      <p>user: {current?.name ?? 'none'}</p>
      <p>note: {kept.data?.title ?? 'none'}</p>
      <button type="button" onClick={logout}>
        Sign out
      </button>
      <button type="button" onClick={() => void login('other@example.com', 'pw')}>
        Sign in as the other user
      </button>
    </div>
  );
}

const renderApp = () =>
  renderWithProviders(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

const signedIn = { 'GET /api/auth/me': { body: user } };

describe('the notes kept for reading offline', () => {
  it('are read back without a connection, for the user the token names', async () => {
    setToken(tokenFor(user.id));
    await seedOfflineCache(user);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderApp();
    expect(await screen.findByText('status: signed-in')).toBeInTheDocument();
    expect(screen.getByText('user: Demo User')).toBeInTheDocument();
    expect(await screen.findByText('note: Kept for Demo User')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('are not there for anyone else: offline with another user’s token, nothing opens', async () => {
    setToken(tokenFor(other.id));
    await seedOfflineCache(user);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderApp();
    expect(await screen.findByText('status: offline')).toBeInTheDocument();
    expect(screen.getByText('note: none')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('go when the user signs out', async () => {
    mockFetch(signedIn);
    setToken(tokenFor(user.id));
    await seedOfflineCache(user);
    renderApp();
    await screen.findByText('status: signed-in');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(async () => expect(await keptUsers()).toEqual([]));
    expect(screen.getByText('note: none')).toBeInTheDocument();
  });

  it('go on a 401, when the session was ended elsewhere', async () => {
    mockFetch({ ...signedIn, 'GET /api/notes/n2': { status: 401, body: { message: 'Unauthorized' } } });
    setToken(tokenFor(user.id));
    await seedOfflineCache(user);
    renderApp();
    await screen.findByText('status: signed-in');
    await act(() => api('/notes/n2').catch(() => undefined));
    expect(screen.getByText('status: signed-out')).toBeInTheDocument();
    await waitFor(async () => expect(await keptUsers()).toEqual([]));
  });

  it('go when another tab signs out, "sign out everywhere" included', async () => {
    mockFetch(signedIn);
    setToken(tokenFor(user.id));
    await seedOfflineCache(user);
    renderApp();
    await screen.findByText('status: signed-in');
    // The other tab removed the token. This tab hears of it through the storage event.
    localStorage.removeItem('notes.token');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'notes.token', newValue: null })));
    expect(screen.getByText('status: signed-out')).toBeInTheDocument();
    await waitFor(async () => expect(await keptUsers()).toEqual([]));
  });

  it('are let go in a tab that finds another user signed in under it, and the page starts again', async () => {
    mockFetch(signedIn);
    setToken(tokenFor(user.id));
    await seedOfflineCache(user);
    const reload = vi.spyOn(page, 'reload').mockImplementation(() => undefined);
    const work = { save: vi.fn(), discard: vi.fn(), putAside: vi.fn() };
    const unregister = registerUnsavedWork(work);
    renderApp();
    expect(await screen.findByText('note: Kept for Demo User')).toBeInTheDocument();
    await screen.findByText('status: signed-in');

    // A renewed token for the same user changes nothing.
    localStorage.setItem('notes.token', tokenFor(user.id) + 'x');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'notes.token' })));
    expect(reload).not.toHaveBeenCalled();

    // Another tab signed in as someone else.
    localStorage.setItem('notes.token', tokenFor(other.id));
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'notes.token' })));
    expect(reload).toHaveBeenCalledTimes(1);
    // The draft goes aside under the old user and is never saved as the new one.
    expect(work.putAside).toHaveBeenCalled();
    expect(work.discard).toHaveBeenCalled();
    expect(work.save).not.toHaveBeenCalled();
    await screen.findByText('note: none');
    unregister();
  });

  it('do not come back for a sign-in that a sign-out overtook', async () => {
    mockFetch({ 'POST /api/auth/login': { body: { token: tokenFor(other.id), user: other } } });
    await seedOfflineCache(other);
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in as the other user' }));
    // Signed out before the kept copy was read.
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getByText('status: signed-out')).toBeInTheDocument();
    expect(screen.getByText('user: none')).toBeInTheDocument();
  });

  it('of one user go when another user signs in on this browser', async () => {
    mockFetch({ 'POST /api/auth/login': { body: { token: tokenFor(other.id), user: other } } });
    await seedOfflineCache(user);
    renderApp();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in as the other user' }));
    expect(await screen.findByText('user: Other User')).toBeInTheDocument();
    await waitFor(async () => expect(await keptUsers()).not.toContain(user.id));
    expect(getToken()).toBe(tokenFor(other.id));
  });
});
