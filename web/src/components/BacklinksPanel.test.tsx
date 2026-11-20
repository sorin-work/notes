import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/render';
import { BacklinksPanel } from './BacklinksPanel';

describe('BacklinksPanel', () => {
  it('lists the notes that link here with their context', async () => {
    mockFetch({
      'GET /api/notes/n1/backlinks': {
        body: [{ id: 'n2', title: 'Weekly sync', updatedAt: '2026-01-02T10:00:00Z', context: 'See Project Atlas' }],
      },
    });
    renderWithProviders(<BacklinksPanel noteId="n1" />, { route: '/notes/n1?tag=atlas' });

    expect(await screen.findByRole('link', { name: 'Weekly sync' })).toHaveAttribute('href', '/notes/n2?tag=atlas');
    expect(screen.getByText('See Project Atlas')).toBeInTheDocument();
  });

  it('shows the unlinked mentions under the backlinks', async () => {
    mockFetch({
      'GET /api/notes/n1/backlinks': { body: [] },
      'GET /api/notes/n1/mentions': {
        body: {
          items: [
            {
              id: 'n3',
              title: 'Minutes',
              updatedAt: '2026-01-02T10:00:00Z',
              before: 'About the ',
              match: 'atlas',
              after: '.',
              offset: 10,
              version: 3,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 10,
          capped: false,
        },
      },
    });
    renderWithProviders(<BacklinksPanel noteId="n1" />);

    expect(await screen.findByRole('button', { name: 'Link the mention in Minutes' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual(['Backlinks', 'Unlinked mentions1']);
  });

  it('explains how to link when nothing links here', async () => {
    mockFetch({ 'GET /api/notes/n1/backlinks': { body: [] } });
    renderWithProviders(<BacklinksPanel noteId="n1" />);
    expect(await screen.findByText(/No notes link here yet/)).toBeInTheDocument();
  });
});
