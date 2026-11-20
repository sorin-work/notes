import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { mockFetch, renderWithProviders } from '../test/render';
import { UnlinkedMentions } from './UnlinkedMentions';

const mention = (id: string, title: string) => ({
  id,
  title,
  updatedAt: '2026-01-02T10:00:00Z',
  context: `We talked about the atlas in ${title}.`,
});
const page = (items: object[], total = items.length, number = 1, capped = false) => ({
  items,
  total,
  page: number,
  pageSize: 10,
  capped,
});

describe('UnlinkedMentions', () => {
  it('lists the notes that mention this one and links a mention on request', async () => {
    let linked = false;
    const calls = mockFetch({
      'GET /api/notes/n1/mentions': () => ({ body: page(linked ? [] : [mention('n2', 'Minutes')]) }),
      'POST /api/notes/n1/mentions/n2/link': () => {
        linked = true;
        return { status: 204 };
      },
    });
    const { queryClient } = renderWithProviders(<UnlinkedMentions noteId="n1" />, { route: '/notes/n1?tag=atlas' });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    expect(await screen.findByRole('heading', { name: /Unlinked mentions/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: 'Minutes' })).toHaveAttribute('href', '/notes/n2?tag=atlas');
    expect(screen.getByText('We talked about the atlas in Minutes.')).toBeInTheDocument();
    expect(calls[0]?.url).toBe('/api/notes/n1/mentions?page=1&pageSize=10');
    await expectNoAxeViolations({ part: true });

    await userEvent.click(screen.getByRole('button', { name: 'Link the mention in Minutes' }));
    // The mention is a backlink now, so the list is empty and goes away.
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Unlinked mentions/ })).not.toBeInTheDocument());
    expect(calls.some((call) => call.method === 'POST' && call.url === '/api/notes/n1/mentions/n2/link')).toBe(true);
    for (const queryKey of [['backlinks'], ['notes'], ['note', 'n2'], ['links', 'n2'], ['versions', 'n2']]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('shows nothing when no note mentions this one', async () => {
    const calls = mockFetch({ 'GET /api/notes/n1/mentions': { body: page([]) } });
    const { container } = renderWithProviders(<UnlinkedMentions noteId="n1" />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });

  it('loads more, and says when the server did not look at every note', async () => {
    const first = Array.from({ length: 10 }, (_, i) => mention(`m${i}`, `Note ${i}`));
    const calls = mockFetch({
      'GET /api/notes/n1/mentions': ({ url }) =>
        url.includes('page=2')
          ? { body: page([mention('last', 'The last one')], 11, 2, true) }
          : { body: page(first, 11, 1, true) },
    });
    renderWithProviders(<UnlinkedMentions noteId="n1" />);

    expect(await screen.findByText(/There may be more/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'The last one' })).toBeInTheDocument();
    expect(calls.at(-1)?.url).toBe('/api/notes/n1/mentions?page=2&pageSize=10');
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('says why a mention could not be linked, and asks for the list again', async () => {
    const calls = mockFetch({
      'GET /api/notes/n1/mentions': { body: page([mention('n2', 'Minutes')]) },
      'POST /api/notes/n1/mentions/n2/link': {
        status: 409,
        body: { statusCode: 409, message: 'That note no longer mentions "Atlas" without a link' },
      },
    });
    renderWithProviders(<UnlinkedMentions noteId="n1" />);

    await userEvent.click(await screen.findByRole('button', { name: 'Link the mention in Minutes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer mentions');
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2));
  });
});
