import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/render';
import { ShareDialog } from './ShareDialog';

const share = { token: 'tok123', viewCount: 3, createdAt: '2026-01-01T00:00:00Z' };

describe('ShareDialog', () => {
  it('creates a link', async () => {
    let shared = false;
    const calls = mockFetch({
      'GET /api/notes/n1/share': () => ({ body: { share: shared ? share : null } }),
      'POST /api/notes/n1/share': () => {
        shared = true;
        return { body: share };
      },
    });
    renderWithProviders(<ShareDialog noteId="n1" onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create link' }));
    expect(await screen.findByLabelText('Share link')).toHaveValue(`${window.location.origin}/s/tok123`);
    expect(screen.getByText(/viewed 3 times/)).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(true);
  });

  it('stops sharing', async () => {
    let shared = true;
    mockFetch({
      'GET /api/notes/n1/share': () => ({ body: { share: shared ? share : null } }),
      'DELETE /api/notes/n1/share': () => {
        shared = false;
        return { status: 204 };
      },
    });
    renderWithProviders(<ShareDialog noteId="n1" onClose={vi.fn()} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Stop sharing' }));
    expect(await screen.findByRole('button', { name: 'Create link' })).toBeInTheDocument();
  });
});
