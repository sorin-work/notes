import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import { useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { mockFetch, renderWithProviders } from '../test/render';
import { QuickSwitcher } from './QuickSwitcher';

function Where() {
  const location = useLocation();
  return <output>{location.pathname + location.search}</output>;
}

function renderSwitcher(route = '/notes') {
  const onClose = vi.fn();
  renderWithProviders(
    <>
      <Where />
      <QuickSwitcher onClose={onClose} />
    </>,
    { route },
  );
  return onClose;
}

/** The switcher with a button to open it again, the way Layout keeps it around. */
function Reopenable() {
  const [open, setOpen] = useState(true);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Where />
      <button type="button" onClick={() => setOpen(true)}>
        Open again
      </button>
      {open && <QuickSwitcher onClose={close} />}
    </>
  );
}

const recent = [
  { id: 'n1', title: 'Project Atlas' },
  { id: 'n2', title: 'Weekly review' },
  { id: 'n3', title: 'Groceries' },
];

describe('QuickSwitcher', () => {
  it('lists the notes edited last, without the open one, and opens the highlighted note', async () => {
    const calls = mockFetch({ 'GET /api/notes/titles': { body: recent } });
    const onClose = renderSwitcher('/notes/n1?notebook=w');

    const input = screen.getByRole('combobox', { name: 'Note title' });
    expect(input).toHaveFocus();
    expect(await screen.findByRole('option', { name: 'Weekly review' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('option', { name: 'Project Atlas' })).not.toBeInTheDocument();
    expect(calls[0]?.url).toBe('/api/notes/titles?limit=10');

    await userEvent.keyboard('{ArrowDown}');
    const groceries = screen.getByRole('option', { name: 'Groceries' });
    expect(groceries).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', groceries.id);

    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent('/notes/n3?notebook=w');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the first match for the typed text when Enter comes before the answer', async () => {
    const matches = [recent[2], { id: 'n4', title: 'Group plan' }];
    const calls = mockFetch({
      'GET /api/notes/titles': ({ url }) => ({ body: url.includes('q=gro') ? matches : recent }),
    });
    const onClose = renderSwitcher('/search?q=atlas');

    // The arrow key moves through the older list, which is not what Enter is meant for.
    await screen.findByRole('option', { name: 'Project Atlas' });
    await userEvent.type(screen.getByRole('combobox'), 'gro{ArrowDown}{Enter}');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent(/^\/notes\/n3$/);
    expect(calls.some((call) => call.url === '/api/notes/titles?q=gro&limit=10')).toBe(true);
  });

  it('does not act on a list kept from last time until it has been refreshed', async () => {
    let fresh: (() => void) | null = null;
    const refreshed = new Promise<void>((resolve) => {
      fresh = resolve;
    });
    let opened = 0;
    mockFetch({
      'GET /api/notes/titles': async () => {
        if (++opened === 1) return { body: recent };
        // By the second time the note that was first has been deleted.
        await refreshed;
        return { body: recent.slice(1) };
      },
    });
    renderWithProviders(<Reopenable />, { route: '/notes' });

    await screen.findByRole('option', { name: 'Project Atlas' });
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Open again' }));
    expect(screen.getByRole('option', { name: 'Project Atlas' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('status')).toHaveTextContent(/^\/notes$/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fresh?.();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^\/notes\/n2$/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says when no title matches, and Enter then does nothing', async () => {
    mockFetch({ 'GET /api/notes/titles': ({ url }) => ({ body: url.includes('q=') ? [] : recent }) });
    const onClose = renderSwitcher();

    await userEvent.type(screen.getByRole('combobox'), 'zzz{Enter}');
    expect(await screen.findByText('No note has “zzz” in its title.')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('/notes');
  });
});
