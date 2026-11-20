import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueText, replay, startOutbox } from '../lib/outbox';
import { expectNoAxeViolations } from '../test/axe';
import { note, user, userToken } from '../test/fixtures';
import { setToken } from '../api/client';
import { mockFetch, renderWithProviders } from '../test/render';
import { PendingChanges } from './PendingChanges';

describe('PendingChanges', () => {
  beforeEach(() => setToken(userToken));

  it('says what is waiting, lists what cannot be applied, and gives up a change only when told', async () => {
    const current = note({ id: 'n2', content: 'Changed elsewhere', revision: 9 });
    mockFetch({
      'PATCH /api/notes/n1': { status: 409, body: { statusCode: 409, message: 'This note is in the trash.' } },
      'PATCH /api/notes/n2': {
        status: 409,
        body: { statusCode: 409, error: 'Conflict', message: 'changed', code: 'stale_revision', note: current },
      },
    });
    await startOutbox(user.id, new QueryClient());
    renderWithProviders(<PendingChanges />);
    await act(async () => {
      await queueText(user.id, 'n1', { title: 'Thrown away', content: 'x' }, 1);
      await queueText(user.id, 'n2', { title: 'Plan', content: 'Mine' }, 3);
      await replay();
    });

    const list = await screen.findByRole('region', { name: 'Changes not sent yet' });
    expect(list).toHaveTextContent(
      'Thrown away: could not be sent. The note is in the trash. Restore it and the change is sent.',
    );
    expect(screen.getByRole('button', { name: 'Save as a new note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy text' })).toBeInTheDocument();
    expect(list).toHaveTextContent('Plan: the note was changed elsewhere meanwhile. Open it to decide what to keep.');
    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/notes/n2');
    await expectNoAxeViolations({ part: true });

    await userEvent.click(screen.getByRole('button', { name: 'Discard this change' }));
    await waitFor(() => expect(list).not.toHaveTextContent('Thrown away'));
    expect(list).toHaveTextContent('Plan');
  });

  it('counts what waits for a connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await startOutbox(user.id, new QueryClient());
    renderWithProviders(<PendingChanges />);
    await act(() => queueText(user.id, 'n1', { title: 'Plan', content: 'x' }, 1));
    expect(await screen.findByText(/1 change made without a connection/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
