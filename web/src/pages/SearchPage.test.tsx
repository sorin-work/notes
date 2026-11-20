import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router';
import { describe, expect, it } from 'vitest';
import { notebook } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { SearchPage } from './SearchPage';

const hit = (id: string, title: string) => ({
  id,
  title,
  snippet: 'The \u0002weekly\u0003 sync',
  notebookId: null,
  tags: ['meeting'],
  pinned: false,
  favorite: false,
  updatedAt: '2026-01-02T10:00:00Z',
});
const page = (items: object[] = [], total = items.length, number = 1) => ({
  items,
  total,
  page: number,
  pageSize: 30,
});
const lists = {
  'GET /api/notebooks': {
    body: [notebook({ id: 'w', name: 'Work' }), notebook({ id: 'm', name: 'Meetings', parentId: 'w' })],
  },
  'GET /api/tags': { body: [{ id: 't1', name: 'atlas', noteCount: 2 }] },
};

/** Shows the query string, and stands in for the search box in the sidebar. */
function Outside() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output>{location.search}</output>
      <button type="button" onClick={() => navigate('/search?q=lisbon')}>
        Search from the sidebar
      </button>
    </>
  );
}

function renderPage(route: string) {
  return renderWithProviders(
    <>
      <Outside />
      <SearchPage />
    </>,
    { route },
  );
}

describe('SearchPage', () => {
  it('searches as you type and highlights matches', async () => {
    const calls = mockFetch({ ...lists, 'GET /api/search': { body: page([hit('n1', 'Atlas weekly sync')]) } });
    renderPage('/search');

    await userEvent.type(screen.getByLabelText('Search all notes'), 'week');
    expect(await screen.findByText('weekly', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Atlas weekly sync/ })).toHaveAttribute('href', '/notes/n1');
    expect(screen.getByText('1 note matches')).toBeInTheDocument();
    expect(calls.at(-1)?.url).toContain('q=week');
    expect(screen.getByRole('status')).toHaveTextContent('?q=week');
  });

  it('starts from the query in the URL', async () => {
    const calls = mockFetch({ ...lists, 'GET /api/search': { body: page() } });
    renderPage('/search?q=lisbon');
    expect(screen.getByLabelText('Search all notes')).toHaveValue('lisbon');
    expect(await screen.findByText('Nothing matches “lisbon”.')).toBeInTheDocument();
    expect(calls.find((call) => call.url.startsWith('/api/search'))?.url).toContain('q=lisbon');
  });

  it('narrows the search to a notebook and a tag, and keeps both in the URL', async () => {
    const calls = mockFetch({ ...lists, 'GET /api/search': { body: page() } });
    renderPage('/search?q=sync');

    await screen.findByRole('option', { name: 'Work' });
    await userEvent.selectOptions(screen.getByLabelText('Filter by notebook'), 'm');
    await userEvent.selectOptions(screen.getByLabelText('Filter by tag'), 'atlas');

    expect(screen.getByRole('status')).toHaveTextContent('?q=sync&notebook=m&tag=atlas');
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/search?q=sync&notebookId=m&tag=atlas&page=1&pageSize=30'));
    expect(await screen.findByText('Nothing matches “sync” with these filters.')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by notebook'), 'none');
    await waitFor(() => expect(calls.at(-1)?.url).toContain('notebookId=none&tag=atlas'));
  });

  it('loads more results when there is more than one page', async () => {
    const first = Array.from({ length: 30 }, (_, i) => hit(`a${i}`, `Sync ${i}`));
    const calls = mockFetch({
      ...lists,
      'GET /api/search': ({ url }) =>
        url.includes('page=2') ? { body: page([hit('last', 'The last sync')], 31, 2) } : { body: page(first, 31) },
    });
    renderPage('/search?q=sync&tag=atlas');

    expect(await screen.findByText('31 notes match')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: /The last sync/ })).toBeInTheDocument();
    expect(calls.at(-1)?.url).toBe('/api/search?q=sync&tag=atlas&page=2&pageSize=30');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('takes over a query that arrives in the URL from outside', async () => {
    const calls = mockFetch({ ...lists, 'GET /api/search': { body: page() } });
    renderPage('/search?q=atlas&notebook=w');
    await screen.findByText('Nothing matches “atlas” with these filters.');

    await userEvent.click(screen.getByRole('button', { name: 'Search from the sidebar' }));
    expect(await screen.findByText('Nothing matches “lisbon”.')).toBeInTheDocument();
    expect(screen.getByLabelText('Search all notes')).toHaveValue('lisbon');

    // The older text in the box must not find its way back into the URL once typing would have settled.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(screen.getByRole('status')).toHaveTextContent(/^\?q=lisbon$/);
    expect(screen.getByLabelText('Search all notes')).toHaveValue('lisbon');
    expect(calls.at(-1)?.url).toBe('/api/search?q=lisbon&page=1&pageSize=30');
  });
});
