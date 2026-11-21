import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { notebook } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { describeResult, SelectionBar } from './SelectionBar';

const notebooks = [
  notebook({ id: 'w', name: 'Work' }),
  notebook({ id: 'm', name: 'Meetings', parentId: 'w' }),
  notebook({ id: 'r', name: 'Recipes', shared: true, sharedThrough: { id: 'r', name: 'Recipes' } }),
  notebook({ id: 'k', name: 'Kitchen', memberCount: 2 }),
];

function renderBar(ids = ['a', 'b'], from: string | null = null) {
  const selected = ids.map((id) => ({ id, notebookId: from }));
  return renderWithProviders(
    <SelectionBar selected={selected} loaded={3} notebooks={notebooks} onSelectAll={vi.fn()} onClear={vi.fn()} />,
  );
}

describe('SelectionBar', () => {
  it('moves the selected notes in one request, and undoes the move in one more', async () => {
    const calls = mockFetch({
      'POST /api/notes/bulk': ({ body }: { body: unknown }) => {
        const { ids, action } = body as { ids: string[]; action: string };
        return {
          body:
            action === 'move'
              ? { changed: ids, unchanged: [], skipped: [], previous: { a: null, b: 'w' } }
              : { changed: ['a'], unchanged: [], skipped: [{ id: 'b', reason: 'moved_since' }] },
        };
      },
    });
    renderBar();
    expect(screen.getByText('2 notes selected')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move to' }), 'Work / Meetings');
    expect(await screen.findByText('Moved to “Work / Meetings”: 2 notes.')).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ ids: ['a', 'b'], action: 'move', notebookId: 'm' });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await screen.findByText('Moved back 1 note. 1 note was moved again since, and stayed where it is.'),
    ).toBeInTheDocument();
    // Where each note goes back to, and where they are all expected to be now.
    expect(calls.slice(1).map((call) => call.body)).toEqual([
      { ids: ['a', 'b'], action: 'moveBack', back: { a: null, b: 'w' }, expectedNotebookId: 'm' },
    ]);
  });

  it('says who gains and who loses the notes when a move crosses a notebook shared with members', async () => {
    const calls = mockFetch({ 'POST /api/notes/bulk': { body: { changed: ['a'], unchanged: [], skipped: [] } } });
    const { unmount } = renderBar(['a']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move to' }), 'Kitchen');
    expect(await screen.findByRole('dialog', { name: 'Change who can read these notes?' })).toHaveTextContent(
      '“Kitchen” is shared with 2 other accounts, who will see the notes moved there.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(calls).toHaveLength(0);
    unmount();

    renderBar(['a'], 'k');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move to' }), 'Work');
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'The 2 other accounts that “Kitchen” is shared with will no longer see the notes moved out of it.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move to “Work”' }));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it('asks before a move into a notebook shared with a link', async () => {
    const calls = mockFetch({ 'POST /api/notes/bulk': { body: { changed: ['a'], unchanged: [], skipped: [] } } });
    renderBar(['a']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move to' }), 'Recipes');
    expect(await screen.findByRole('dialog', { name: 'Change who can read these notes?' })).toHaveTextContent(
      'shared with a link',
    );
    expect(calls).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Move to “Recipes”' }));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it('tags the selection and says which notes were left out', async () => {
    const calls = mockFetch({
      'POST /api/notes/bulk': {
        body: { changed: ['a'], unchanged: [], skipped: [{ id: 'b', reason: 'not_allowed' }] },
      },
    });
    renderBar();
    await userEvent.type(screen.getByRole('textbox', { name: 'Tag' }), 'winter');
    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(
      await screen.findByText('Tagged #winter: 1 note. 1 note is not yours to change that way.'),
    ).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ ids: ['a', 'b'], action: 'addTag', tag: 'winter' });
  });

  it('needs a connection', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderBar();
    expect(screen.getByText('These actions need a connection.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin' })).toBeDisabled();
    vi.restoreAllMocks();
  });
});

describe('describeResult', () => {
  it('counts what changed, what was so already and why the rest was left out', () => {
    expect(
      describeResult(
        'Pinned',
        {
          changed: ['a', 'b'],
          unchanged: ['c'],
          skipped: [
            { id: 'd', reason: 'in_trash' },
            { id: 'e', reason: 'in_trash' },
          ],
        },
        1,
      ),
    ).toBe(
      'Pinned 2 notes. 1 note was already so. 2 notes are in the trash. 1 note made without a connection is not on the server yet.',
    );
  });
});
