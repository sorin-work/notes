import { useQuery } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { getNote } from '../api/notes';
import { note } from '../test/fixtures';
import { expectNoAxeViolations } from '../test/axe';
import { mockFetch, renderWithProviders } from '../test/render';
import { UnlinkedMentions } from './UnlinkedMentions';

const mention = (id: string, title: string) => ({
  id,
  title,
  updatedAt: '2026-01-02T10:00:00Z',
  before: `In ${title} we talked about the `,
  match: 'atlas',
  after: ' at length.',
  offset: 40,
  version: 'a'.repeat(64),
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
    // The line of the mention, with the mention itself marked.
    const marked = screen.getByText('atlas', { selector: 'mark' });
    expect(marked.parentElement).toHaveTextContent('In Minutes we talked about the atlas at length.');
    expect(calls[0]?.url).toBe('/api/notes/n1/mentions?page=1&pageSize=10');
    await expectNoAxeViolations({ part: true });

    await userEvent.click(screen.getByRole('button', { name: 'Link the mention in Minutes' }));
    // The mention is a backlink now, so the list is empty and goes away.
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Unlinked mentions/ })).not.toBeInTheDocument());
    // "Link" names the mention that was shown: where it is, how it reads and the text it was found in.
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({
      url: '/api/notes/n1/mentions/n2/link',
      body: { offset: 40, text: 'atlas', version: 'a'.repeat(64) },
    });
    for (const queryKey of [['backlinks'], ['notes'], ['links', 'n2'], ['versions', 'n2']]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey });
    }
  });

  it('does not leave the old text of the linked note for the editor to pick up', async () => {
    // The editor reads a note from the cache when it is there, and keeps what it read as its own text.
    function Editor({ id }: { id: string }) {
      const opened = useQuery({ queryKey: ['note', id], queryFn: () => getNote(id) });
      return opened.data ? <Text key={id} content={opened.data.content} /> : <p>Loading the note</p>;
    }
    function Text({ content }: { content: string }) {
      const [text] = useState(content);
      return <textarea aria-label="Note content" readOnly value={text} />;
    }
    function App() {
      const [open, setOpen] = useState<'n1' | 'n2'>('n2');
      return (
        <>
          <button type="button" onClick={() => setOpen(open === 'n1' ? 'n2' : 'n1')}>
            Open the other note
          </button>
          {open === 'n2' ? <Editor id="n2" /> : <UnlinkedMentions noteId="n1" />}
        </>
      );
    }

    let content = 'We looked at the atlas.';
    mockFetch({
      'GET /api/notes/n2': () => ({ body: note({ id: 'n2', title: 'Minutes', content }) }),
      'GET /api/notes/n1/mentions': () => ({ body: page(content.includes('[[') ? [] : [mention('n2', 'Minutes')]) }),
      'POST /api/notes/n1/mentions/n2/link': () => {
        content = 'We looked at the [[atlas]].';
        return { status: 204 };
      },
    });
    renderWithProviders(<App />);
    // The other note is opened first, so its text from before the link is in the cache.
    expect(await screen.findByLabelText('Note content')).toHaveValue('We looked at the atlas.');

    await userEvent.click(screen.getByRole('button', { name: 'Open the other note' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Link the mention in Minutes' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /Unlinked mentions/ })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Open the other note' }));
    expect(await screen.findByLabelText('Note content')).toHaveValue('We looked at the [[atlas]].');
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
