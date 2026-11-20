import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { mockFetch, renderWithProviders } from '../test/render';
import { ShareDialog } from './ShareDialog';

const share = {
  token: 'tok123',
  viewCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
  expiresAt: null as string | null,
  expired: false,
  hasPassword: false,
};

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

  it('shares a notebook through the notebook routes, and says what that covers', async () => {
    let shared = false;
    const calls = mockFetch({
      'GET /api/notebooks/nb1/share': () => ({ body: { share: shared ? share : null } }),
      'POST /api/notebooks/nb1/share': () => {
        shared = true;
        return { body: share };
      },
    });
    renderWithProviders(<ShareDialog notebookId="nb1" onClose={vi.fn()} />);

    expect(await screen.findByRole('dialog', { name: 'Share notebook' })).toBeInTheDocument();
    expect(await screen.findByText(/also the ones\s+you add later/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }));

    expect(await screen.findByLabelText('Share link')).toHaveValue(`${window.location.origin}/s/tok123`);
    expect(screen.getByLabelText('Link runs out')).toBeInTheDocument();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain('POST /api/notebooks/nb1/share');
  });

  it('sets when the link runs out, and lifts the limit again', async () => {
    let current = share;
    const calls = mockFetch({
      'GET /api/notes/n1/share': () => ({ body: { share: current } }),
      'PATCH /api/notes/n1/share': ({ body }) => {
        current = { ...current, ...(body as { expiresAt: string | null }) };
        return { body: current };
      },
    });
    renderWithProviders(<ShareDialog noteId="n1" onClose={vi.fn()} />);

    const before = Date.now();
    await userEvent.selectOptions(await screen.findByLabelText('Link runs out'), 'In a week');
    await screen.findByRole('option', { name: /^On / });
    const sent = calls.find((call) => call.method === 'PATCH')?.body as { expiresAt: string };
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(new Date(sent.expiresAt).getTime()).toBeGreaterThanOrEqual(before + week);
    expect(new Date(sent.expiresAt).getTime()).toBeLessThan(before + week + 60_000);

    await userEvent.selectOptions(screen.getByLabelText('Link runs out'), 'Never');
    await waitFor(() => expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2));
    expect(calls.filter((call) => call.method === 'PATCH')[1]?.body).toEqual({ expiresAt: null });
  });

  it('says when the link has run out', async () => {
    mockFetch({
      'GET /api/notes/n1/share': { body: { share: { ...share, expiresAt: '2026-02-01T10:00:00Z', expired: true } } },
    });
    renderWithProviders(<ShareDialog noteId="n1" onClose={vi.fn()} />);

    expect(await screen.findByText(/This link ran out on/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^Ran out / })).toBeInTheDocument();
  });

  it('sets a password for readers and takes it away again', async () => {
    let current = share;
    const calls = mockFetch({
      'GET /api/notes/n1/share': () => ({ body: { share: current } }),
      'PATCH /api/notes/n1/share': ({ body }) => {
        current = { ...current, hasPassword: (body as { password: string | null }).password !== null };
        return { body: current };
      },
    });
    renderWithProviders(<ShareDialog noteId="n1" onClose={vi.fn()} />);

    await userEvent.type(await screen.findByLabelText('Ask readers for a password'), 'open sesame');
    await userEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText(/Readers are asked for a password/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ password: 'open sesame' });
    // The password is not kept on screen, and the API never sends it back.
    expect(screen.getByLabelText('Change the password')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Remove password' }));
    expect(await screen.findByLabelText('Ask readers for a password')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'PATCH')[1]?.body).toEqual({ password: null });
  });

  it('passes the axe checks', async () => {
    mockFetch({
      'GET /api/notes/n1/share': {
        body: { share: { ...share, expiresAt: '2026-02-01T10:00:00Z', expired: true, hasPassword: true } },
      },
    });
    renderWithProviders(<ShareDialog noteId="n1" onClose={vi.fn()} />);
    await screen.findByLabelText('Share link');
    await expectNoAxeViolations({ part: true });
  });
});
