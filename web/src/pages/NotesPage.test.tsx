import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { note, notebook, summary } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { NotesPage } from './NotesPage';

function renderPage(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/notes" element={<NotesPage />} />
      <Route path="/notes/:noteId" element={<NotesPage />} />
    </Routes>,
    { route },
  );
}

const page = (items = [summary()], total = items.length) => ({ items, total, page: 1, pageSize: 50 });

describe('NotesPage', () => {
  it('names the notebook being shown and asks for its notes', async () => {
    const calls = mockFetch({
      'GET /api/notes': { body: page() },
      'GET /api/notebooks': {
        body: [notebook({ id: 'w', name: 'Work' }), notebook({ id: 'm', name: 'Meetings', parentId: 'w' })],
      },
    });
    renderPage('/notes?notebook=m');

    expect(await screen.findByRole('heading', { name: 'Work / Meetings' })).toBeInTheDocument();
    expect(screen.getByText('1 note')).toBeInTheDocument();
    expect(calls.find((call) => call.url.startsWith('/api/notes?'))?.url).toContain('notebookId=m');
  });

  it('narrows the list by view, notebook and tag together', async () => {
    const calls = mockFetch({
      'GET /api/notes': { body: page() },
      'GET /api/notebooks': { body: [notebook({ id: 'w', name: 'Work' })] },
      'GET /api/tags': {
        body: [
          { id: 't1', name: 'atlas', noteCount: 2 },
          { id: 't2', name: 'ideas', noteCount: 1 },
        ],
      },
    });
    renderPage('/notes?view=pinned&notebook=w&tag=atlas');

    expect(await screen.findByRole('heading', { name: 'Pinned · Work · #atlas' })).toBeInTheDocument();
    const asked = () =>
      new URLSearchParams(calls.findLast((call) => call.url.startsWith('/api/notes?'))?.url.split('?')[1]);
    expect(Object.fromEntries(asked())).toMatchObject({ notebookId: 'w', tag: 'atlas', pinned: 'true' });

    // Changing one select keeps what the others and the view narrow.
    await userEvent.selectOptions(await screen.findByLabelText('Filter by tag'), 'ideas');
    expect(await screen.findByRole('heading', { name: 'Pinned · Work · #ideas' })).toBeInTheDocument();
    await waitFor(() =>
      expect(Object.fromEntries(asked())).toMatchObject({ notebookId: 'w', tag: 'ideas', pinned: 'true' }),
    );
  });

  it('creates a note that fits every filter of the list', async () => {
    const calls = mockFetch({
      'GET /api/notes': { body: page([]) },
      'GET /api/notebooks': { body: [] },
      'GET /api/tags': { body: [{ id: 't1', name: 'atlas', noteCount: 2 }] },
      'POST /api/notes': { status: 201, body: note({ id: 'new', title: 'Untitled' }) },
      'GET /api/notes/new': { body: note({ id: 'new', title: 'Untitled' }) },
    });
    renderPage('/notes?notebook=none&tag=atlas&view=favorites');

    expect(await screen.findByRole('heading', { name: 'Favourites · Not in a notebook · #atlas' })).toBeInTheDocument();
    expect(calls.find((call) => call.url.startsWith('/api/notes?'))?.url).toContain('notebookId=none');
    await userEvent.click(await screen.findByRole('button', { name: 'Create a note' }));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      notebookId: null,
      tags: ['atlas'],
      favorite: true,
    });
  });

  it('loads more notes when there are more than one page', async () => {
    const first = Array.from({ length: 50 }, (_, i) => summary({ id: `a${i}`, title: `Note ${i}` }));
    const calls = mockFetch({
      'GET /api/notes': ({ url }) =>
        url.includes('page=2')
          ? { body: { ...page([summary({ id: 'last', title: 'The last one' })], 51), page: 2 } }
          : { body: page(first, 51) },
      'GET /api/notebooks': { body: [] },
    });
    renderPage('/notes');

    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('The last one')).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('page=2'))).toBe(true);
  });

  it('creates a note in the notebook being shown', async () => {
    const calls = mockFetch({
      'GET /api/notes': { body: page([]) },
      'GET /api/notebooks': { body: [notebook({ id: 'w', name: 'Work' })] },
      'POST /api/notes': { status: 201, body: note({ id: 'new', title: 'Untitled' }) },
      'GET /api/notes/new': { body: note({ id: 'new', title: 'Untitled' }) },
    });
    renderPage('/notes?notebook=w');

    await userEvent.click(await screen.findByRole('button', { name: 'Create a note' }));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ notebookId: 'w' });
  });

  it('lists the templates in a view of their own, and creates a template there', async () => {
    const calls = mockFetch({
      'GET /api/notes': { body: page([summary({ id: 't1', title: 'Weekly review template' })]) },
      'GET /api/notebooks': { body: [] },
      'POST /api/notes': { body: note({ id: 'new', isTemplate: true }) },
      'GET /api/notes/new': { body: note({ id: 'new', isTemplate: true }) },
    });
    renderPage('/notes?view=templates');

    expect(await screen.findByRole('heading', { name: 'Templates' })).toBeInTheDocument();
    expect(await screen.findByText('1 template')).toBeInTheDocument();
    expect(calls.find((call) => call.url.startsWith('/api/notes?'))?.url).toContain('templates=true');

    await userEvent.keyboard('{Alt>}n{/Alt}');
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ notebookId: null, isTemplate: true });
  });
});
