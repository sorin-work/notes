import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { note } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { VersionHistoryDialog } from './VersionHistoryDialog';

describe('VersionHistoryDialog', () => {
  it('previews a version and restores it', async () => {
    const versions = [
      { id: 'v2', title: 'Plan', characters: 20, createdAt: '2026-01-02T10:00:00Z' },
      { id: 'v1', title: 'Plan', characters: 5, createdAt: '2026-01-01T10:00:00Z' },
    ];
    const calls = mockFetch({
      'GET /api/notes/n1/versions': { body: versions },
      'GET /api/notes/n1/versions/v2': { body: { ...versions[0], content: '# Newer draft' } },
      'GET /api/notes/n1/versions/v1': { body: { ...versions[1], content: '# First draft' } },
      'POST /api/notes/n1/versions/v1/restore': { body: note({ content: '# First draft' }) },
    });
    const onRestored = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(<VersionHistoryDialog noteId="n1" onClose={onClose} onRestored={onRestored} />);

    expect(await screen.findByRole('heading', { name: 'Newer draft' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /5 characters/ }));
    expect(await screen.findByRole('heading', { name: 'First draft' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(expect.objectContaining({ content: '# First draft' })));
    expect(onClose).toHaveBeenCalled();
    expect(calls.at(-1)).toMatchObject({ method: 'POST', url: '/api/notes/n1/versions/v1/restore' });
  });

  it('explains when there are no versions yet', async () => {
    mockFetch({ 'GET /api/notes/n1/versions': { body: [] } });
    renderWithProviders(<VersionHistoryDialog noteId="n1" onClose={vi.fn()} onRestored={vi.fn()} />);
    expect(await screen.findByText(/No earlier versions yet/)).toBeInTheDocument();
  });
});
