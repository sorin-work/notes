import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/render';
import { SearchPage } from './SearchPage';

describe('SearchPage', () => {
  it('searches as you type and highlights matches', async () => {
    const calls = mockFetch({
      'GET /api/search': {
        body: {
          items: [
            {
              id: 'n1',
              title: 'Atlas weekly sync',
              snippet: 'The \u0002weekly\u0003 sync',
              notebookId: null,
              tags: ['meeting'],
              pinned: false,
              favorite: false,
              updatedAt: '2026-01-02T10:00:00Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 30,
        },
      },
    });
    renderWithProviders(<SearchPage />, { route: '/search' });

    await userEvent.type(screen.getByLabelText('Search all notes'), 'week');
    expect(await screen.findByText('weekly', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Atlas weekly sync/ })).toHaveAttribute('href', '/notes/n1');
    expect(screen.getByText('1 note matches')).toBeInTheDocument();
    expect(calls.at(-1)?.url).toContain('q=week');
  });

  it('starts from the query in the URL', async () => {
    const calls = mockFetch({ 'GET /api/search': { body: { items: [], total: 0, page: 1, pageSize: 30 } } });
    renderWithProviders(<SearchPage />, { route: '/search?q=lisbon' });
    expect(screen.getByLabelText('Search all notes')).toHaveValue('lisbon');
    expect(await screen.findByText('Nothing matches “lisbon”.')).toBeInTheDocument();
    expect(calls[0]?.url).toContain('q=lisbon');
  });
});
