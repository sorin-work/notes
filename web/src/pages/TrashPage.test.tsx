import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/render';
import { TrashPage } from './TrashPage';

const trashed = {
  id: 'n9',
  title: 'Old meeting template',
  excerpt: 'Agenda',
  notebook: { id: 'nb', name: 'Meetings' },
  deletedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  purgeAt: new Date(Date.now() + 28 * 86_400_000).toISOString(),
};

describe('TrashPage', () => {
  it('lists trashed notes with when they will be deleted', async () => {
    mockFetch({ 'GET /api/trash': { body: [trashed] } });
    renderWithProviders(<TrashPage />);
    expect(await screen.findByText('Old meeting template')).toBeInTheDocument();
    expect(screen.getByText(/gone for good in 28 days/)).toBeInTheDocument();
  });

  it('restores a note', async () => {
    const calls = mockFetch({
      'GET /api/trash': { body: [trashed] },
      'POST /api/trash/n9/restore': { status: 204 },
    });
    renderWithProviders(<TrashPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/trash/n9/restore')).toBe(true);
  });

  it('asks before deleting forever', async () => {
    const calls = mockFetch({
      'GET /api/trash': { body: [trashed] },
      'DELETE /api/trash/n9': { status: 204 },
    });
    renderWithProviders(<TrashPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete forever' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('cannot be undone');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/trash/n9')).toBe(true);
  });

  it('says when the trash is empty', async () => {
    mockFetch({ 'GET /api/trash': { body: [] } });
    renderWithProviders(<TrashPage />);
    expect(await screen.findByText('The trash is empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Empty trash' })).not.toBeInTheDocument();
  });
});
