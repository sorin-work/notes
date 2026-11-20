import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { getToken, setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { localDay } from '../lib/days';
import { readStash, stashDraft } from '../lib/draftStash';
import { outboxEntryFor, queueText, unsentAfterTrying } from '../lib/outbox';
import { registerUnsavedWork } from '../lib/unsavedWork';
import { expectNoAxeViolations } from '../test/axe';
import { note, notebook, summary, user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { Sidebar } from './Sidebar';

/** Where the sidebar navigated to. */
function Where() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

function renderSidebar(route = '/notes') {
  setToken('tok');
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Sidebar />
              <Where />
            </>
          }
        />
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
    expect(dialog).toHaveTextContent('3 notes move to the trash');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete notebook' }));
    expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/notebooks/w')).toBe(true);
  });

  it('says that the templates in a notebook go to the trash with it', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: [notebook({ id: 'f', name: 'Forms', templateCount: 2 })] },
      'GET /api/tags': { body: [] },
    });
    renderSidebar();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete Forms' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 templates move to the trash');
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

  it('makes a note from a template, in the notebook being shown, with today’s values', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'GET /api/notes': { body: { items: [summary({ id: 't1', title: 'Weekly review template' })], total: 1 } },
      'POST /api/notes': { body: note({ id: 'new', title: 'Weekly review' }) },
    });
    renderSidebar('/notes?notebook=m&view=templates');

    expect(await screen.findByRole('link', { name: 'Templates' })).toHaveAttribute('aria-current', 'page');
    const choice = await screen.findByRole('combobox', { name: 'New from template' });
    await expectNoAxeViolations({ part: true });
    expect(calls.find((call) => call.url.startsWith('/api/notes?'))?.url).toContain('templates=true');
    // Choosing alone makes nothing, as the arrow keys on a closed select choose too.
    await userEvent.selectOptions(choice, 'Weekly review template');
    choice.focus();
    await userEvent.keyboard('{ArrowUp}{ArrowDown}');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      templateId: 't1',
      notebookId: 'm',
      placeholders: {
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        time: expect.stringMatching(/^\d{2}:\d{2}$/),
      },
    });
  });

  it('says why no note was made from a template', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'GET /api/notes': { body: { items: [summary({ id: 't1', title: 'Weekly review template' })], total: 1 } },
      'POST /api/notes': { status: 404, body: { statusCode: 404, message: 'Template not found' } },
    });
    renderSidebar();

    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'New from template' }), 't1');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Template not found');
  });

  it('offers no template to choose from when there is none', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'GET /api/notes': { body: { items: [], total: 0 } },
    });
    renderSidebar();
    expect(await screen.findByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/notes?view=templates');
    await screen.findByRole('link', { name: /Work/ });
    expect(screen.queryByRole('combobox', { name: 'New from template' })).not.toBeInTheDocument();
  });

  it('opens the note of today, with the day worked out here and the title left to the server', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': {
        body: { ...user, preferences: { dailyNotes: { notebookId: null, templateId: null, dateFormat: 'long' } } },
      },
      'GET /api/notebooks': { body: [] },
      'GET /api/tags': { body: [] },
      'POST /api/notes/daily': { body: note({ id: 'today' }) },
    });
    renderSidebar('/notes?view=pinned');

    const before = localDay();
    await userEvent.click(await screen.findByRole('button', { name: 'Today' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    const sent = calls.find((call) => call.method === 'POST')?.body as { date: string };
    // No title: the format this tab read at load time may have been changed elsewhere since.
    expect(sent).toEqual({
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      placeholders: { date: sent.date, time: expect.stringMatching(/^\d{2}:\d{2}$/) },
    });
    // The day is the one the clock here shows, also when the test runs across midnight.
    expect([before, localDay()]).toContain(sent.date);
  });

  it('says so when the note of today cannot be opened', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: [] },
      'GET /api/tags': { body: [] },
      'POST /api/notes/daily': { status: 500, body: { message: 'Internal server error' } },
    });
    renderSidebar();
    await userEvent.click(await screen.findByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Today’s note could not be opened.');
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

    it('tries to send changes made offline first, and asks before throwing them away', async () => {
      mockFetch({ ...routes, 'PATCH /api/notes/n1': () => Promise.reject(new TypeError('Failed to fetch')) });
      renderSidebar();
      // Signed in, so the outbox is this user's.
      await screen.findByText(user.name);
      await queueText(user.id, 'n1', { title: 'Plan', content: 'Typed on the train.' }, 3);

      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      const dialog = await screen.findByRole('dialog', { name: 'Sign out without saving?' });
      expect(dialog).toHaveTextContent('1 change made without a connection has not reached the server yet.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(getToken()).toBe('tok');
      expect(outboxEntryFor('n1')).not.toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out and discard' }));
      await waitFor(() => expect(getToken()).toBeNull());
      expect(await unsentAfterTrying(user.id)).toBe(0);
    });
  });

  it('makes a note without a connection, under an id made here, and keeps it to be sent', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'POST /api/notes': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    renderSidebar('/notes?notebook=m');
    await screen.findByRole('link', { name: /Work/ });
    await screen.findByText(user.name);
    await userEvent.click(screen.getByRole('button', { name: '+ New note' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/notes\/[0-9a-f-]{36}/));
    const id = screen.getByTestId('location').textContent!.split('/')[2]!.split('?')[0]!;
    expect(outboxEntryFor(id)).toMatchObject({ kind: 'create', notebookId: 'm', state: 'waiting' });
  });
});
