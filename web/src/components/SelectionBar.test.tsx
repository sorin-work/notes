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
];

function renderBar(selected = ['a', 'b']) {
  return renderWithProviders(
    <SelectionBar selected={selected} loaded={3} notebooks={notebooks} onSelectAll={vi.fn()} onClear={vi.fn()} />,
  );
}

describe('SelectionBar', () => {
  it('moves the selected notes in one request, and undoes the move note by note', async () => {
    const calls = mockFetch({
      'POST /api/notes/bulk': ({ body }: { body: unknown }) => {
        const { ids, notebookId } = body as { ids: string[]; notebookId: string | null };
        return {
          body:
            notebookId === 'm'
              ? { changed: ids, unchanged: [], skipped: [], previous: { a: null, b: 'w' } }
              : { changed: ids, unchanged: [], skipped: [] },
        };
      },
    });
    renderBar();
    expect(screen.getByText('2 notes selected')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move to' }), 'Work / Meetings');
    expect(await screen.findByText('Moved to “Work / Meetings”: 2 notes.')).toBeInTheDocument();
    expect(calls[0]?.body).toEqual({ ids: ['a', 'b'], action: 'move', notebookId: 'm' });

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Moved 2 notes back.')).toBeInTheDocument();
    const back = calls.slice(1).map((call) => call.body);
    expect(back).toEqual(
      expect.arrayContaining([
        { ids: ['a'], action: 'move', notebookId: null },
        { ids: ['b'], action: 'move', notebookId: 'w' },
      ]),
    );
  });

  it('asks before a move into a notebook shared with a link', async () => {
    const calls = mockFetch({ 'POST /api/notes/bulk': { body: { changed: ['a'], unchanged: [], skipped: [] } } });
    renderBar(['a']);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Move to' }), 'Recipes');
    expect(await screen.findByRole('dialog', { name: 'Make these notes public?' })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Move them' }));
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
