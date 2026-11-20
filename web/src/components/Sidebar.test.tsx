import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { getToken, setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { readStash, stashDraft } from '../lib/draftStash';
import { registerUnsavedWork } from '../lib/unsavedWork';
import { notebook, user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { Sidebar } from './Sidebar';

function renderSidebar(route = '/notes') {
  setToken('tok');
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="*" element={<Sidebar />} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

const notebooks = [
  notebook({ id: 'w', name: 'Work', noteCount: 1 }),
  notebook({ id: 'm', name: 'Meetings', parentId: 'w', noteCount: 2 }),
  notebook({ id: 'p', name: 'Personal', noteCount: 0 }),
];

describe('Sidebar', () => {
  it('shows notebooks nested under their parent with note counts', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [{ id: 't', name: 'atlas', noteCount: 4 }] },
    });
    renderSidebar('/notes?notebook=m');

    const work = await screen.findByRole('link', { name: /Work/ });
    expect(work).toHaveTextContent('3');
    const meetings = screen.getByRole('link', { name: /Meetings/ });
    expect(meetings).toHaveAttribute('aria-current', 'page');
    expect(meetings.closest('ul')?.closest('li')).toContainElement(work);
    expect(screen.getByRole('link', { name: /#atlas/ })).toHaveAttribute('href', '/notes?tag=atlas');
    expect(screen.getByRole('link', { name: 'Not in a notebook' })).toHaveAttribute('href', '/notes?notebook=none');
    expect(screen.getByRole('link', { name: 'Orphans' })).toHaveAttribute('href', '/notes?view=orphans');
    expect(screen.getByRole('link', { name: 'All notes' })).not.toHaveAttribute('aria-current');
  });

  it('warns before deleting a notebook that its notes go to the trash', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'DELETE /api/notebooks/w': { body: { trashedNotes: 3 } },
    });
    renderSidebar();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete Work' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('and the notebooks inside it');
    expect(dialog).toHaveTextContent('notes move to the trash');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete notebook' }));
    expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/notebooks/w')).toBe(true);
  });

  it('creates a notebook inside another one', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'POST /api/notebooks': { status: 201, body: notebook({ id: 'new', name: 'Ideas', parentId: 'p' }) },
    });
    renderSidebar();

    await userEvent.click(await screen.findByRole('button', { name: 'New notebook inside Personal' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Ideas');
    expect(screen.getByLabelText('Inside')).toHaveValue('p');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ name: 'Ideas', parentId: 'p' });
  });

  it('marks what a notebook link makes public, and asks before a notebook is moved into a shared one', async () => {
    const recipes = { id: 'r', name: 'Recipes' };
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': {
        body: [
          notebook({ id: 'r', name: 'Recipes', shared: true, sharedThrough: recipes }),
          notebook({ id: 'b', name: 'Bread', parentId: 'r', sharedThrough: recipes }),
          notebook({ id: 'p', name: 'Personal' }),
        ],
      },
      'GET /api/tags': { body: [] },
      'PATCH /api/notebooks/p': {
        body: notebook({ id: 'p', name: 'Personal', parentId: 'r', sharedThrough: recipes }),
      },
    });
    renderSidebar();

    const recipesLink = await screen.findByRole('link', { name: /Recipes/ });
    expect(within(recipesLink).getByText('public')).toHaveAttribute(
      'title',
      'Shared with a link: anyone who has it can read the notes in here',
    );
    expect(within(screen.getByRole('link', { name: /Bread/ })).getByText('public')).toHaveAttribute(
      'title',
      'Public through the shared notebook “Recipes”',
    );
    expect(within(screen.getByRole('link', { name: /Personal/ })).queryByText('public')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Personal' }));
    await userEvent.selectOptions(screen.getByLabelText('Inside'), 'r');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('can be read by anyone who has that link');
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Move it and make it public' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ name: 'Personal', parentId: 'r' }),
    );
  });

  it('opens the share dialog for a notebook', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'GET /api/notebooks/w/share': { body: { share: null } },
    });
    renderSidebar();

    await userEvent.click(await screen.findByRole('button', { name: 'Share Work' }));

    const dialog = within(await screen.findByRole('dialog', { name: 'Share notebook' }));
    expect(await dialog.findByRole('button', { name: 'Create link' })).toBeInTheDocument();
  });

  describe('signing out', () => {
    const routes = {
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: [] },
      'GET /api/tags': { body: [] },
    };

    it('saves what is unsaved first', async () => {
      mockFetch(routes);
      const work = { save: vi.fn().mockResolvedValue(true), discard: vi.fn() };
      const unregister = registerUnsavedWork(work);
      renderSidebar();

      await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      await waitFor(() => expect(getToken()).toBeNull());
      expect(work.save).toHaveBeenCalledTimes(1);
      expect(work.discard).not.toHaveBeenCalled();
      unregister();
    });

    it('asks before throwing away a draft that cannot be saved, and only then forgets what was kept for the user', async () => {
      mockFetch(routes);
      const work = { save: vi.fn().mockResolvedValue(false), discard: vi.fn() };
      const unregister = registerUnsavedWork(work);
      const draft = { title: 'Plan', content: 'Unsaved.', revision: 3 };
      stashDraft(user.id, 'n1', draft);
      stashDraft('someone-else', 'n1', draft);
      renderSidebar();

      await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      const dialog = await screen.findByRole('dialog', { name: 'Sign out without saving?' });
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      // Still signed in, and nothing was given up.
      expect(getToken()).toBe('tok');
      expect(work.discard).not.toHaveBeenCalled();
      expect(readStash(user.id, 'n1')).not.toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out and discard' }));
      await waitFor(() => expect(getToken()).toBeNull());
      expect(work.discard).toHaveBeenCalledTimes(1);
      expect(readStash(user.id, 'n1')).toBeNull();
      expect(readStash('someone-else', 'n1')).not.toBeNull();
      unregister();
    });
  });
});
