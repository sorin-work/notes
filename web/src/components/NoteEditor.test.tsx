import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { Note } from '../api/types';
import { note } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { NoteEditor } from './NoteEditor';

function baseRoutes(overrides = {}) {
  return {
    'GET /api/notes/n1': { body: note() },
    'GET /api/notebooks': { body: [] },
    'GET /api/tags': { body: [{ id: 't1', name: 'atlas', noteCount: 1 }] },
    'GET /api/notes/n1/links': { body: [{ title: 'Atlas data model', noteId: null }] },
    'GET /api/notes/n1/backlinks': { body: [] },
    'PATCH /api/notes/n1': ({ body }: { body: unknown }) => ({ body: { ...note(), ...(body as object) } }),
    ...overrides,
  };
}

function renderEditor(state?: unknown, mode = 'split') {
  localStorage.setItem('notes.editorMode', mode);
  return renderWithProviders(
    <Routes>
      <Route path="/notes/:noteId" element={<NoteEditor noteId="n1" />} />
      <Route path="/notes/:noteId" element={<div />} />
    </Routes>,
    { route: { pathname: '/notes/n1', state } },
  );
}

describe('NoteEditor', () => {
  it('shows the note with a live preview', async () => {
    mockFetch(baseRoutes());
    renderEditor();

    expect(await screen.findByLabelText('Title')).toHaveValue('Project Atlas');
    const textarea = screen.getByLabelText('Note content');
    fireEvent.change(textarea, { target: { value: '# Fresh heading' } });
    expect(screen.getByRole('heading', { name: 'Fresh heading' })).toBeInTheDocument();
  });

  it('autosaves edits to the title and content', async () => {
    const calls = mockFetch(baseRoutes());
    renderEditor();

    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Atlas v2');
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true), { timeout: 2000 });
    const patches = calls.filter((call) => call.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({ title: 'Atlas v2', content: 'Links to [[Atlas data model]].' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved/));
  });

  it('pins the note straight away', async () => {
    const calls = mockFetch(baseRoutes());
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ pinned: true }));
    expect(await screen.findByRole('button', { name: 'Unpin' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks links to missing notes in the preview', async () => {
    mockFetch(baseRoutes());
    renderEditor();
    await waitFor(() => expect(screen.getByRole('link', { name: 'Atlas data model' })).toHaveClass('wikilink-missing'));
  });

  it('suggests note titles after [[ and inserts the chosen one', async () => {
    mockFetch(
      baseRoutes({
        'GET /api/notes/titles': {
          body: [
            { id: 'n2', title: 'Weekly review' },
            { id: 'n3', title: 'Weekly sync' },
          ],
        },
      }),
    );
    renderEditor();

    const textarea = await screen.findByLabelText('Note content');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'See [[[[Wee');
    const option = await screen.findByRole('option', { name: 'Weekly sync' });
    expect(screen.getByRole('option', { name: /New note Wee/ })).toBeInTheDocument();

    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(option).not.toBeInTheDocument();
    expect(textarea).toHaveValue('See [[Weekly sync]]');
  });

  it('ticks tasks from the preview and saves the change like typed text', async () => {
    const content = 'For [[Dinner]]:\n\n- [x] Lemons\n- [ ] Bread flour\n';
    const calls = mockFetch(baseRoutes({ 'GET /api/notes/n1': { body: note({ content }) } }));
    renderEditor();

    const flour = await screen.findByRole('checkbox', { name: 'Bread flour' });
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Note content');
    textarea.setSelectionRange(4, 14);

    await userEvent.click(flour);
    expect(textarea).toHaveValue('For [[Dinner]]:\n\n- [x] Lemons\n- [x] Bread flour\n');
    // The box is still the same element, so keyboard users keep their place.
    expect(flour).toBeChecked();
    expect(flour).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Lemons' }));
    const ticked = 'For [[Dinner]]:\n\n- [ ] Lemons\n- [x] Bread flour\n';
    expect(textarea).toHaveValue(ticked);

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true), { timeout: 2000 });
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
      { title: 'Project Atlas', content: ticked },
    ]);
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([4, 14]);
  });

  it('compares versions with the text in the editor, saved or not', async () => {
    const version = { id: 'v1', title: 'Project Atlas', characters: 30, createdAt: '2026-01-01T10:00:00Z' };
    mockFetch(
      baseRoutes({
        'GET /api/notes/n1/versions': { body: [version] },
        'GET /api/notes/n1/versions/v1': { body: { ...version, content: 'Links to [[Atlas data model]].' } },
      }),
    );
    renderEditor();

    fireEvent.change(await screen.findByLabelText('Note content'), {
      target: { value: 'Links to [[Atlas data model]].\nNot saved yet' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Changes' }));

    expect(screen.getByText('Not saved yet').closest('.diff-line')).toHaveClass('diff-added');
    expect(screen.getByText('Links to [[Atlas data model]].').closest('.diff-line')).toHaveClass('diff-same');
  });

  it('puts the cursor in the text when the quick switcher opened the note', async () => {
    mockFetch(baseRoutes());
    renderEditor({ focusEditor: true });
    expect(await screen.findByLabelText('Note content')).toHaveFocus();
  });

  it('gives the preview the focus instead when the text is not showing', async () => {
    mockFetch(baseRoutes());
    renderEditor({ focusEditor: true }, 'preview');
    expect(await screen.findByLabelText('Preview')).toHaveFocus();
    expect(screen.queryByLabelText('Note content')).not.toBeInTheDocument();
  });

  describe('after a rename', () => {
    /**
     * Routes for a note that answers with what was last saved, as the API
     * does. `left` is how many notes still link to the old title.
     */
    function renameRoutes(left: number, afterUpdate = { left: 0, skipped: 0 }) {
      let saved = note();
      return baseRoutes({
        'GET /api/notes/n1': () => ({ body: saved }),
        'PATCH /api/notes/n1': ({ body }: { body: unknown }) => {
          saved = { ...saved, ...(body as object) };
          saved.title = saved.title.trim() || 'Untitled';
          return { body: saved };
        },
        'GET /api/notes/n1/rename-links': () => ({ body: { count: left } }),
        'POST /api/notes/n1/rename-links': () => {
          const updated = left - afterUpdate.skipped;
          left = afterUpdate.left;
          const noteIds = Array.from({ length: updated }, (_, index) => `linking-${index}`);
          return { body: { updated, skipped: afterUpdate.skipped, title: saved.title, noteIds } };
        },
      });
    }

    /** Types a new title and leaves the field, the way Tab or a click into the text does. */
    async function rename(to: string) {
      const title = await screen.findByLabelText('Title');
      await userEvent.clear(title);
      if (to) await userEvent.type(title, to);
      await userEvent.tab();
    }

    const askedForLinks = (calls: { url: string }[]) => calls.filter((call) => call.url.includes('/rename-links'));

    it('offers to update the links other notes have to the old title, naming both titles', async () => {
      const calls = mockFetch(renameRoutes(2));
      renderEditor();
      await rename('Atlas v2');

      // The offer comes once the new title is saved, and names the title the note was opened with.
      const update = await screen.findByRole('button', {
        name: 'Update 2 links from [[Project Atlas]] to [[Atlas v2]]',
      });
      expect(screen.getByText(/2 notes still link to \[\[Project Atlas\]\]/)).toBeInTheDocument();
      expect(askedForLinks(calls).at(-1)).toMatchObject({
        method: 'GET',
        url: '/api/notes/n1/rename-links?from=Project+Atlas',
      });
      expect(calls.some((call) => call.method === 'POST')).toBe(false);

      await userEvent.click(update);
      await waitFor(() => expect(screen.queryByText(/still link/)).not.toBeInTheDocument());
      const posted = calls.findIndex((call) => call.method === 'POST');
      expect(calls[posted]).toMatchObject({ url: '/api/notes/n1/rename-links', body: { from: 'Project Atlas' } });
      // The new title was saved before the links were pointed at it.
      const patched = calls.findIndex((call) => call.method === 'PATCH' && (call.body as Note).title === 'Atlas v2');
      expect(patched).toBeGreaterThan(-1);
      expect(patched).toBeLessThan(posted);
    });

    it('offers nothing while the title is still being typed', async () => {
      const calls = mockFetch(renameRoutes(2));
      renderEditor();
      const title = await screen.findByLabelText('Title');
      await userEvent.clear(title);
      await userEvent.type(title, 'Atlas');

      // The half typed title is saved by the autosave, but the cursor is still in the field.
      await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true), { timeout: 2000 });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved/));
      expect(askedForLinks(calls)).toEqual([]);
      expect(screen.queryByText(/still link/)).not.toBeInTheDocument();

      await userEvent.type(title, ' v2');
      await userEvent.tab();
      expect(
        await screen.findByRole('button', { name: 'Update 2 links from [[Project Atlas]] to [[Atlas v2]]' }),
      ).toBeInTheDocument();
    });

    it('offers nothing for a title that was emptied and is saved as "Untitled"', async () => {
      const calls = mockFetch(renameRoutes(2));
      renderEditor();
      await rename('');

      await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true), { timeout: 2000 });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved/));
      expect(askedForLinks(calls)).toEqual([]);
      expect(screen.queryByText(/still link/)).not.toBeInTheDocument();
    });

    it('can be told "Not now", and asks again when the title changes once more', async () => {
      const calls = mockFetch(renameRoutes(1));
      renderEditor();
      await rename('Atlas v2');

      expect(await screen.findByText(/1 note still links to \[\[Project Atlas\]\]/)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Update 1 link from [[Project Atlas]] to [[Atlas v2]]' }),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
      expect(screen.queryByText(/still links/)).not.toBeInTheDocument();

      await userEvent.type(screen.getByLabelText('Title'), '.1');
      await userEvent.tab();
      expect(await screen.findByText(/1 note still links to \[\[Project Atlas\]\]/)).toBeInTheDocument();
      expect(calls.some((call) => call.method === 'POST')).toBe(false);
    });

    it('says how many notes were left behind and keeps the offer for them', async () => {
      mockFetch(renameRoutes(3, { left: 1, skipped: 2 }));
      renderEditor();
      await rename('Atlas v2');
      await userEvent.click(
        await screen.findByRole('button', { name: 'Update 3 links from [[Project Atlas]] to [[Atlas v2]]' }),
      );

      // One of the two can be tried again, the other one cannot be rewritten at all.
      expect(await screen.findByText(/2 notes were left as they are/)).toBeInTheDocument();
      expect(
        await screen.findByRole('button', { name: 'Update 1 link from [[Project Atlas]] to [[Atlas v2]]' }),
      ).toBeInTheDocument();
    });
  });

  it('shows notes in the trash as read-only', async () => {
    mockFetch(
      baseRoutes({
        'GET /api/notes/n1': { body: note({ content: '- [ ] Call the bank', deletedAt: '2026-01-03T00:00:00Z' }) },
      }),
    );
    renderEditor();
    expect(await screen.findByText(/This note is in the trash/)).toBeInTheDocument();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('explains when the note does not exist', async () => {
    mockFetch({ 'GET /api/notes/n1': { status: 404, body: { message: 'Note not found' } } });
    renderEditor();
    expect(await screen.findByText(/This note does not exist/)).toBeInTheDocument();
  });
});
