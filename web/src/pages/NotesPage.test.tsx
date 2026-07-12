import { screen } from '@testing-library/react';
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
});
