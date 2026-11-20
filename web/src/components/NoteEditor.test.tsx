import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { Link, Route, Routes, useParams } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { setToken } from '../api/client';
import type { Note, NoteChanges } from '../api/types';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { readStash, stashDraft } from '../lib/draftStash';
import { expectNoAxeViolations } from '../test/axe';
import { note, notebook, user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { NoteEditor } from './NoteEditor';
import { Notices } from './Notices';

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

  it('asks before a move into a shared notebook, and says afterwards that the note is public', async () => {
    const recipes = { id: 'nb-recipes', name: 'Recipes' };
    const calls = mockFetch(
      baseRoutes({
        'GET /api/notebooks': {
          body: [
            notebook({ id: 'nb-recipes', name: 'Recipes', shared: true, sharedThrough: recipes }),
            notebook({ id: 'nb-work', name: 'Work' }),
          ],
        },
        'PATCH /api/notes/n1': ({ body }: { body: unknown }) => {
          const { notebookId } = body as { notebookId: string | null };
          return { body: { ...note(), notebookId, sharedThrough: notebookId === 'nb-recipes' ? recipes : null } };
        },
      }),
    );
    renderEditor();
    const select = await screen.findByLabelText('Notebook');
    await screen.findByRole('option', { name: 'Recipes' });
    const patches = () => calls.filter((call) => call.method === 'PATCH');

    // A notebook nobody can read: no question.
    await userEvent.selectOptions(select, 'nb-work');
    await waitFor(() => expect(patches()).toHaveLength(1));

    await userEvent.selectOptions(select, 'nb-recipes');
    expect(await screen.findByRole('dialog', { name: 'Make this note public?' })).toHaveTextContent(
      'can be read by anyone who has that link',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(patches()).toHaveLength(1);
    expect(screen.queryByText(/can read this note/)).not.toBeInTheDocument();

    await userEvent.selectOptions(select, 'nb-recipes');
    await userEvent.click(await screen.findByRole('button', { name: 'Move it' }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]?.body).toEqual({ notebookId: 'nb-recipes' });
    expect(
      await screen.findByText('Anyone with the link to the shared notebook “Recipes” can read this note.'),
    ).toBeInTheDocument();
  });

  it('puts the preview on the page while printing in "Edit", and only then', async () => {
    mockFetch(baseRoutes({ 'GET /api/notes/n1': { body: note({ content: '# Printed heading' }) } }));
    renderEditor(undefined, 'edit');
    await screen.findByLabelText('Note content');
    expect(screen.queryByRole('heading', { name: 'Printed heading' })).not.toBeInTheDocument();

    fireEvent(window, new Event('beforeprint'));
    expect(screen.getByRole('heading', { name: 'Printed heading' })).toBeInTheDocument();
    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Printed heading' })).not.toBeInTheDocument());
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
    // A save names the revision the text was based on.
    expect(patches[0]?.body).toEqual({ title: 'Atlas v2', content: 'Links to [[Atlas data model]].', revision: 3 });
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
    // Offered once it is known that no note, and no template, has that title.
    expect(await screen.findByRole('option', { name: /New note Wee/ })).toBeInTheDocument();
    // The text field tells a screen reader where the list is and which option is highlighted.
    expect(textarea).toHaveAttribute('aria-controls', screen.getByRole('listbox', { name: 'Link to note' }).id);
    expect(textarea).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Weekly review' }).id);

    await userEvent.keyboard('{ArrowDown}');
    expect(textarea).toHaveAttribute('aria-activedescendant', option.id);
    await userEvent.keyboard('{Enter}');
    expect(option).not.toBeInTheDocument();
    expect(textarea).toHaveValue('See [[Weekly sync]]');
    expect(textarea).not.toHaveAttribute('aria-controls');
    expect(textarea).not.toHaveAttribute('aria-activedescendant');
  });

  it('offers no new note for the title of a template, which a link already leads to', async () => {
    const calls = mockFetch(
      baseRoutes({
        'GET /api/notes/titles': { body: [] },
        'GET /api/notes/resolve': { body: { id: 't1', title: 'Weekly review template' } },
      }),
    );
    renderEditor();

    const textarea = await screen.findByLabelText('Note content');
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'See [[[[weekly review template');
    await waitFor(() => expect(calls.some((call) => call.url.startsWith('/api/notes/resolve?'))).toBe(true));
    await waitFor(() => expect(calls.filter((call) => call.url.startsWith('/api/notes/titles?'))).not.toHaveLength(0));
    expect(screen.queryByRole('option', { name: /New note/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('puts the cursor in the title of a note made from a template', async () => {
    mockFetch(baseRoutes({ 'GET /api/notes/n1': { body: note({ title: 'Untitled' }) } }));
    renderEditor({ focusTitle: true });
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus());
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
      { title: 'Project Atlas', content: ticked, revision: 3 },
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

    it('shows the rewritten text when going back to a note whose links were updated', async () => {
      // The editor the way NotesPage mounts it: a new one for every note, on one cache.
      function KeyedEditor() {
        const { noteId = '' } = useParams();
        return <NoteEditor key={noteId} noteId={noteId} />;
      }
      const notes = {
        a: note({ id: 'a', title: 'Atlas', content: 'The project.' }),
        b: note({ id: 'b', title: 'Source', content: 'See [[Atlas]] for more.' }),
      };
      const save = (id: 'a' | 'b') => (request: { body: unknown }) => {
        notes[id] = { ...notes[id], ...(request.body as object) };
        return { body: notes[id] };
      };
      const calls = mockFetch({
        'GET /api/notebooks': { body: [] },
        'GET /api/tags': { body: [] },
        'GET /api/notes/a': () => ({ body: notes.a }),
        'GET /api/notes/b': () => ({ body: notes.b }),
        'PATCH /api/notes/a': save('a'),
        'PATCH /api/notes/b': save('b'),
        'GET /api/notes/a/links': { body: [] },
        'GET /api/notes/b/links': { body: [{ title: 'Atlas', noteId: 'a' }] },
        'GET /api/notes/a/backlinks': {
          body: [{ id: 'b', title: 'Source', updatedAt: '2026-01-02T10:00:00Z', context: '' }],
        },
        'GET /api/notes/b/backlinks': { body: [] },
        'GET /api/notes/resolve': { body: { id: 'a', title: 'Atlas' } },
        'GET /api/notes/a/rename-links': { body: { count: 1 } },
        'POST /api/notes/a/rename-links': () => {
          notes.b = { ...notes.b, content: 'See [[Project Atlas]] for more.' };
          return { body: { updated: 1, skipped: 0, title: notes.a.title, noteIds: ['b'] } };
        },
      });
      localStorage.setItem('notes.editorMode', 'split');
      renderWithProviders(
        <Routes>
          <Route path="/notes/:noteId" element={<KeyedEditor />} />
        </Routes>,
        { route: '/notes/b' },
      );

      // Open B, which puts it in the cache, and follow its link to A. The preview
      // builds its links anew when it renders, so the link is looked up at the click.
      await screen.findByRole('link', { name: 'Atlas' });
      fireEvent.click(screen.getByRole('link', { name: 'Atlas' }));
      const title = await screen.findByDisplayValue('Atlas');
      await userEvent.clear(title);
      await userEvent.type(title, 'Project Atlas');
      await userEvent.tab();
      await userEvent.click(await screen.findByRole('button', { name: /^Update 1 link from/ }));
      await waitFor(() => expect(screen.queryByText(/still links/)).not.toBeInTheDocument());

      // Back in B, the editor has the text with the new link, and that is what a keystroke saves.
      await userEvent.click(await screen.findByRole('link', { name: 'Source' }));
      const text = await screen.findByLabelText('Note content');
      await waitFor(() => expect(text).toHaveValue('See [[Project Atlas]] for more.'));
      await userEvent.type(text, '!');
      await waitFor(
        () =>
          expect(calls.findLast((call) => call.method === 'PATCH' && call.url === '/api/notes/b')?.body).toMatchObject({
            content: 'See [[Project Atlas]] for more.!',
          }),
        { timeout: 2000 },
      );
      // Two notes, two autosaves and a rewrite: more than the usual test takes.
    }, 15_000);
  });

  describe('when the note was changed somewhere else', () => {
    const theirText = 'What the other tab saved.';

    /**
     * A server on which another tab has saved the note as revision 4, while
     * the editor opens it from a copy at revision 3. It answers a save the
     * way the API does: 409 with the current note when the revision is old.
     */
    function conflictRoutes(overrides = {}, server = { saveElsewhere: (_content: string) => {} }) {
      let current = note({ content: theirText, revision: 4, updatedAt: '2026-01-02T11:00:00Z' });
      let loads = 0;
      // What yet another save from the other tab does to the note.
      server.saveElsewhere = (content) => {
        current = { ...current, content, revision: current.revision + 1 };
      };
      return baseRoutes({
        // The editor opens from a copy that is one revision behind. Anything fetched later is the note as it is.
        'GET /api/notes/n1': () => ({ body: loads++ === 0 ? note() : current }),
        'PATCH /api/notes/n1': ({ body }: { body: unknown }) => {
          const { revision, keepVersion: _keepVersion, ...changes } = body as NoteChanges;
          if (!('title' in changes) && !('content' in changes)) return { body: { ...current, ...changes } };
          if (revision !== undefined && revision !== current.revision) {
            const message = 'This note was changed somewhere else since it was opened.';
            return {
              status: 409,
              body: { statusCode: 409, error: 'Conflict', code: 'stale_revision', message, note: current },
            };
          }
          current = { ...current, ...changes, revision: current.revision + 1 };
          return { body: current };
        },
        ...overrides,
      });
    }

    const patches = (calls: { method: string; body: unknown }[]) =>
      calls.filter((call) => call.method === 'PATCH').map((call) => call.body);

    /** Types into the note and waits for the question that the refused save brings up. */
    async function typeIntoConflict(text = 'What I typed here.') {
      const textarea = await screen.findByLabelText('Note content');
      fireEvent.change(textarea, { target: { value: text } });
      const dialog = await screen.findByRole('dialog', { name: 'This note was changed somewhere else' });
      return { textarea, dialog };
    }

    it.each([
      ['Keep mine, put theirs in the history', { keepVersion: true }],
      ['Keep mine', {}],
    ])('saves my text on the new revision with "%s"', async (choice, extra) => {
      const calls = mockFetch(conflictRoutes());
      renderEditor();
      const { textarea } = await typeIntoConflict();
      expect(screen.getByRole('status')).toHaveTextContent('Not saved. This note was changed somewhere else.');
      await expectNoAxeViolations({ part: true });

      await userEvent.click(screen.getByRole('button', { name: choice }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved/));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(textarea).toHaveValue('What I typed here.');
      expect(patches(calls)).toEqual([
        { title: 'Project Atlas', content: 'What I typed here.', revision: 3 },
        { title: 'Project Atlas', content: 'What I typed here.', revision: 4, ...extra },
      ]);

      // Later saves go on from the revision that save produced, without the extra.
      fireEvent.change(textarea, { target: { value: 'And one more line.' } });
      await waitFor(() => expect(patches(calls)).toHaveLength(3), { timeout: 2000 });
      expect(patches(calls)[2]).toEqual({ title: 'Project Atlas', content: 'And one more line.', revision: 5 });
    });

    it('puts their text into the editor with "Take theirs" and sends nothing', async () => {
      const calls = mockFetch(conflictRoutes());
      renderEditor();
      const { textarea } = await typeIntoConflict();

      await userEvent.click(screen.getByRole('button', { name: 'Take theirs' }));
      await waitFor(() => expect(textarea).toHaveValue(theirText));
      expect(screen.getByRole('status')).toHaveTextContent(/^Saved/);
      expect(patches(calls)).toHaveLength(1);

      fireEvent.change(textarea, { target: { value: `${theirText} And mine.` } });
      await waitFor(() => expect(patches(calls)).toHaveLength(2), { timeout: 2000 });
      expect(patches(calls)[1]).toEqual({ title: 'Project Atlas', content: `${theirText} And mine.`, revision: 4 });
    });

    it('takes their text as it is when the choice is made, not as it was when the question came up', async () => {
      const server = { saveElsewhere: (_content: string) => {} };
      const calls = mockFetch(conflictRoutes({}, server));
      renderEditor();
      const { textarea } = await typeIntoConflict();

      // The question stays open while the other tab saves again.
      server.saveElsewhere('What the other tab saved later.');
      await userEvent.click(screen.getByRole('button', { name: 'Take theirs' }));
      await waitFor(() => expect(textarea).toHaveValue('What the other tab saved later.'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.change(textarea, { target: { value: 'On top of the later text.' } });
      await waitFor(() => expect(patches(calls)).toHaveLength(2), { timeout: 2000 });
      expect(patches(calls)[1]).toEqual({ title: 'Project Atlas', content: 'On top of the later text.', revision: 5 });
    });

    it('forces no version after "keep both" ran into a second conflict that ended with "Take theirs"', async () => {
      const server = { saveElsewhere: (_content: string) => {} };
      const calls = mockFetch(conflictRoutes({}, server));
      renderEditor();
      const { textarea } = await typeIntoConflict();

      server.saveElsewhere('What the other tab saved later.');
      await userEvent.click(screen.getByRole('button', { name: 'Keep mine, put theirs in the history' }));
      await waitFor(() => expect(patches(calls)).toHaveLength(2));
      expect(patches(calls)[1]).toMatchObject({ revision: 4, keepVersion: true });
      await userEvent.click(await screen.findByRole('button', { name: 'Take theirs' }));
      await waitFor(() => expect(textarea).toHaveValue('What the other tab saved later.'));

      fireEvent.change(textarea, { target: { value: 'An ordinary edit.' } });
      await waitFor(() => expect(patches(calls)).toHaveLength(3), { timeout: 2000 });
      expect(patches(calls)[2]).toEqual({ title: 'Project Atlas', content: 'An ordinary edit.', revision: 5 });
    });

    it('goes on without a question when the changed note is what this tab sent in a save that was never answered', async () => {
      // The first save is written, but its answer never arrives. The next save carries other text.
      let current = note();
      let failNext = true;
      const calls = mockFetch(
        baseRoutes({
          'PATCH /api/notes/n1': ({ body }: { body: unknown }) => {
            const { revision, ...changes } = body as NoteChanges;
            if (revision !== current.revision) {
              return {
                status: 409,
                body: { statusCode: 409, code: 'stale_revision', message: 'Changed', note: current },
              };
            }
            current = { ...current, ...changes, revision: current.revision + 1 };
            if (failNext) {
              failNext = false;
              throw new TypeError('Failed to fetch');
            }
            return { body: current };
          },
        }),
      );
      renderEditor();
      const textarea = await screen.findByLabelText('Note content');
      fireEvent.change(textarea, { target: { value: 'First text.' } });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Could not save'), { timeout: 2000 });

      fireEvent.change(textarea, { target: { value: 'Second text, not the first.' } });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved/), { timeout: 3000 });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(textarea).toHaveValue('Second text, not the first.');
      expect(patches(calls)).toEqual([
        { title: 'Project Atlas', content: 'First text.', revision: 3 },
        { title: 'Project Atlas', content: 'Second text, not the first.', revision: 3 },
        { title: 'Project Atlas', content: 'Second text, not the first.', revision: 4 },
      ]);
      expect(current.content).toBe('Second text, not the first.');
    });

    it('decides nothing when the question is closed, and keeps my text until I choose', async () => {
      const calls = mockFetch(conflictRoutes());
      renderEditor();
      const { textarea } = await typeIntoConflict();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(textarea).toHaveValue('What I typed here.');
      expect(screen.getByRole('alert')).toHaveTextContent('what you typed here is not saved');
      // Closing the tab now makes the browser ask first.
      const closing = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(closing);
      expect(closing.defaultPrevented).toBe(true);

      // Typing on is kept but not sent, and neither is a save by hand: it brings the question back.
      fireEvent.change(textarea, { target: { value: 'What I typed here. And more.' } });
      await userEvent.keyboard('{Control>}s{/Control}');
      expect(await screen.findByRole('dialog', { name: 'This note was changed somewhere else' })).toBeInTheDocument();
      expect(patches(calls)).toHaveLength(1);

      await userEvent.click(screen.getByRole('button', { name: 'Keep mine' }));
      await waitFor(() => expect(patches(calls)).toHaveLength(2));
      expect(patches(calls)[1]).toEqual({
        title: 'Project Atlas',
        content: 'What I typed here. And more.',
        revision: 4,
      });
    });

    it('saves my text and keeps theirs in the history when the note is left with the question open', async () => {
      const calls = mockFetch(conflictRoutes());
      const { unmount } = renderEditor();
      await typeIntoConflict();
      await userEvent.keyboard('{Escape}');

      unmount();
      await waitFor(() => expect(patches(calls)).toHaveLength(2));
      expect(patches(calls)[1]).toEqual({
        title: 'Project Atlas',
        content: 'What I typed here.',
        revision: 4,
        keepVersion: true,
      });
    });

    it('takes a refused save for saved when the server already has exactly that text', async () => {
      // The answer to an earlier save got lost, so the same text is sent again from the old revision.
      const calls = mockFetch(conflictRoutes());
      renderEditor();
      const textarea = await screen.findByLabelText('Note content');
      fireEvent.change(textarea, { target: { value: theirText } });

      await waitFor(() => expect(patches(calls)).toHaveLength(1), { timeout: 2000 });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved/));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      fireEvent.change(textarea, { target: { value: 'Next edit.' } });
      await waitFor(() => expect(patches(calls)).toHaveLength(2), { timeout: 2000 });
      expect(patches(calls)[1]).toMatchObject({ content: 'Next edit.', revision: 4 });
    });

    it('never conflicts on a pin, and does not take the revision of its answer for the text', async () => {
      // The answer to the pin carries revision 4, but the text in the editor is still the one of revision 3.
      const calls = mockFetch(conflictRoutes());
      renderEditor();
      await userEvent.click(await screen.findByRole('button', { name: 'Pin' }));
      await waitFor(() => expect(patches(calls)).toEqual([{ pinned: true }]));
      expect(await screen.findByRole('button', { name: 'Unpin' })).toBeInTheDocument();

      await typeIntoConflict();
      expect(patches(calls)[1]).toMatchObject({ content: 'What I typed here.', revision: 3 });
    });
  });

  describe('when the note is left before it could be saved', () => {
    function SignedIn({ children }: { children: ReactNode }) {
      return useAuth().status === 'signed-in' ? <>{children}</> : null;
    }

    /** The editor for a signed-in user, with somewhere else to go and the notices beside it, as in the app. */
    function renderSignedIn() {
      setToken('tok');
      localStorage.setItem('notes.editorMode', 'split');
      return renderWithProviders(
        <AuthProvider>
          <SignedIn>
            <Link to="/elsewhere">Leave</Link>
            <Link to="/notes/n1">Back</Link>
            <Routes>
              <Route path="/notes/:noteId" element={<NoteEditor noteId="n1" />} />
              <Route path="/elsewhere" element={<p>Somewhere else</p>} />
            </Routes>
            <Notices />
          </SignedIn>
        </AuthProvider>,
        { route: '/notes/n1' },
      );
    }

    it('keeps the draft in the tab, says so, and offers it when the note is opened again', async () => {
      let online = false;
      let saved = note();
      const calls = mockFetch(
        baseRoutes({
          'GET /api/auth/me': { body: user },
          'GET /api/notes/n1': () => ({ body: saved }),
          'PATCH /api/notes/n1': ({ body }: { body: unknown }) => {
            if (!online) throw new TypeError('Failed to fetch');
            saved = { ...saved, ...(body as object), revision: saved.revision + 1 };
            return { body: saved };
          },
        }),
      );
      renderSignedIn();
      fireEvent.change(await screen.findByLabelText('Note content'), {
        target: { value: 'Typed with no connection.' },
      });
      await userEvent.click(screen.getByRole('link', { name: 'Leave' }));

      expect(await screen.findByText(/Your last changes to “Project Atlas” could not be saved/)).toBeInTheDocument();
      expect(readStash(user.id, 'n1')).toMatchObject({ content: 'Typed with no connection.', revision: 3 });

      online = true;
      await userEvent.click(screen.getByRole('link', { name: 'Back' }));
      expect(await screen.findByText(/could not be saved before you left it/)).toBeInTheDocument();
      // Nothing is put back unasked: the editor shows the note as the server has it.
      expect(screen.getByLabelText('Note content')).toHaveValue('Links to [[Atlas data model]].');

      await userEvent.click(screen.getByRole('button', { name: 'Put them back' }));
      expect(screen.getByLabelText('Note content')).toHaveValue('Typed with no connection.');
      await waitFor(() => expect(saved.content).toBe('Typed with no connection.'), { timeout: 2000 });
      // Saved on the revision it was written on, and only then taken out of the tab.
      expect(calls.findLast((call) => call.method === 'PATCH')?.body).toMatchObject({ revision: 3 });
      await waitFor(() => expect(readStash(user.id, 'n1')).toBeNull());
      expect(screen.queryByText(/could not be saved before you left it/)).not.toBeInTheDocument();
    });

    it('offers only the draft of the user who is signed in, and drops it when told to', async () => {
      mockFetch(baseRoutes({ 'GET /api/auth/me': { body: user } }));
      stashDraft('someone-else', 'n1', { title: 'Theirs', content: 'Not for these eyes.', revision: 3 });
      const { unmount } = renderSignedIn();
      await screen.findByLabelText('Note content');
      expect(screen.queryByText(/could not be saved before you left it/)).not.toBeInTheDocument();
      unmount();

      stashDraft(user.id, 'n1', { title: 'Project Atlas', content: 'Mine, from before.', revision: 3 });
      renderSignedIn();
      await userEvent.click(await screen.findByRole('button', { name: 'Discard them' }));
      expect(screen.queryByText(/could not be saved before you left it/)).not.toBeInTheDocument();
      expect(readStash(user.id, 'n1')).toBeNull();
      expect(screen.getByLabelText('Note content')).toHaveValue('Links to [[Atlas data model]].');
      expect(readStash('someone-else', 'n1')).toMatchObject({ content: 'Not for these eyes.' });
    });

    it('keeps the draft for the user when the session ends under the editor, and offers it after signing in again', async () => {
      let signedIn = true;
      mockFetch(
        baseRoutes({
          'GET /api/auth/me': () => (signedIn ? { body: user } : { status: 401, body: { message: 'Unauthorized' } }),
          'PATCH /api/notes/n1': () =>
            signedIn ? { body: note() } : { status: 401, body: { message: 'Unauthorized', statusCode: 401 } },
        }),
      );
      const first = renderSignedIn();
      fireEvent.change(await screen.findByLabelText('Note content'), { target: { value: 'Typed just before.' } });

      // Signed out in another tab: the token is gone before the editor closes, so its last save is refused.
      signedIn = false;
      setToken(null);
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      await waitFor(() => expect(screen.queryByLabelText('Note content')).not.toBeInTheDocument());
      await waitFor(() =>
        expect(readStash(user.id, 'n1')).toMatchObject({ content: 'Typed just before.', revision: 3 }),
      );
      first.unmount();

      signedIn = true;
      renderSignedIn();
      expect(await screen.findByText(/could not be saved before you left it/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Put them back' }));
      expect(screen.getByLabelText('Note content')).toHaveValue('Typed just before.');
    });

    it('tells afterwards when a newer version from elsewhere was moved to the history on the way out', async () => {
      // The other save is only noticed by the save that leaving the note sets off.
      let current = note({ content: 'What the other tab saved.', revision: 4 });
      const calls = mockFetch(
        baseRoutes({
          'GET /api/auth/me': { body: user },
          'PATCH /api/notes/n1': ({ body }: { body: unknown }) => {
            const { revision, keepVersion: _keepVersion, ...changes } = body as NoteChanges;
            if (revision !== current.revision) {
              return {
                status: 409,
                body: { statusCode: 409, code: 'stale_revision', message: 'Changed', note: current },
              };
            }
            current = { ...current, ...changes, revision: current.revision + 1 };
            return { body: current };
          },
        }),
      );
      renderSignedIn();
      fireEvent.change(await screen.findByLabelText('Note content'), { target: { value: 'Typed, then left.' } });
      await userEvent.click(screen.getByRole('link', { name: 'Leave' }));

      expect(
        await screen.findByText(/“Project Atlas” had been changed somewhere else when you left it/),
      ).toHaveTextContent('the other version was moved to the history');
      expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
        { title: 'Project Atlas', content: 'Typed, then left.', revision: 3 },
        { title: 'Project Atlas', content: 'Typed, then left.', revision: 4, keepVersion: true },
      ]);
      // It was saved, so nothing is left behind in the tab.
      await waitFor(() => expect(readStash(user.id, 'n1')).toBeNull());
    });
  });

  it('saves what is typed before a version is restored, and goes on from the restored revision', async () => {
    const version = { id: 'v1', title: 'Project Atlas', characters: 9, createdAt: '2026-01-01T10:00:00Z' };
    const calls = mockFetch(
      baseRoutes({
        'PATCH /api/notes/n1': ({ body }: { body: unknown }) => ({
          body: { ...note(), ...(body as object), revision: 4 },
        }),
        'GET /api/notes/n1/versions': { body: [version] },
        'GET /api/notes/n1/versions/v1': { body: { ...version, content: 'Old text.' } },
        'POST /api/notes/n1/versions/v1/restore': { body: note({ content: 'Old text.', revision: 5 }) },
      }),
    );
    renderEditor();
    const textarea = await screen.findByLabelText('Note content');
    fireEvent.change(textarea, { target: { value: 'Typed a moment ago.' } });
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore this version' }));

    await waitFor(() => expect(textarea).toHaveValue('Old text.'));
    // The draft went to the server first, where the restore keeps it as a version.
    const sent = calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`);
    expect(sent).toEqual(['PATCH /api/notes/n1', 'POST /api/notes/n1/versions/v1/restore']);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({ content: 'Typed a moment ago.' });

    fireEvent.change(textarea, { target: { value: 'Old text. Plus this.' } });
    await waitFor(() => expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2), { timeout: 2000 });
    expect(calls.findLast((call) => call.method === 'PATCH')?.body).toMatchObject({ revision: 5 });
  });

  it('does not restore a version while what is typed cannot be saved', async () => {
    const version = { id: 'v1', title: 'Project Atlas', characters: 9, createdAt: '2026-01-01T10:00:00Z' };
    const calls = mockFetch(
      baseRoutes({
        'PATCH /api/notes/n1': { status: 500, body: { message: 'Internal server error' } },
        'GET /api/notes/n1/versions': { body: [version] },
        'GET /api/notes/n1/versions/v1': { body: { ...version, content: 'Old text.' } },
      }),
    );
    renderEditor();
    const textarea = await screen.findByLabelText('Note content');
    fireEvent.change(textarea, { target: { value: 'Typed a moment ago.' } });
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Restore this version' }));

    expect(
      await screen.findByText(/Your latest changes are not saved yet, so nothing was restored/),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(textarea).toHaveValue('Typed a moment ago.');
  });

  it('duplicates the note after saving what is typed, and opens the copy', async () => {
    const calls = mockFetch(
      baseRoutes({
        'POST /api/notes/n1/duplicate': { body: note({ id: 'n2', title: 'Project Atlas (copy)' }) },
      }),
    );
    renderEditor();
    fireEvent.change(await screen.findByLabelText('Note content'), { target: { value: 'Typed just now.' } });
    await userEvent.click(screen.getByRole('button', { name: 'Duplicate' }));

    await waitFor(() => expect(calls.some((call) => call.url === '/api/notes/n1/duplicate')).toBe(true));
    const sent = calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`);
    expect(sent).toEqual(['PATCH /api/notes/n1', 'POST /api/notes/n1/duplicate']);
    expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({ content: 'Typed just now.' });
  });

  it('turns a note into a template, which is no edit, and makes a note from it', async () => {
    let saved = note();
    const calls = mockFetch(
      baseRoutes({
        'GET /api/notes/n1': () => ({ body: saved }),
        'PATCH /api/notes/n1': ({ body }: { body: unknown }) => {
          saved = { ...saved, ...(body as object) };
          return { body: saved };
        },
        'POST /api/notes': { body: note({ id: 'n2', title: 'Project Atlas' }) },
      }),
    );
    const { queryClient } = renderEditor();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const toggle = await screen.findByRole('button', { name: 'Template' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/This is a template/)).not.toBeInTheDocument();

    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'));
    // No title, no content and no revision: like a pin, it cannot conflict with typing.
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ isTemplate: true });
    // A template is no backlink and no link suggestion, so neither waits for its cache time.
    const refreshed = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0]);
    expect(refreshed).toEqual(expect.arrayContaining(['backlinks', 'titles']));

    expect(screen.getByText(/This is a template/)).toBeInTheDocument();
    await expectNoAxeViolations({ part: true });
    await userEvent.click(screen.getByRole('button', { name: 'New note from this template' }));
    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      templateId: 'n1',
      notebookId: null,
      placeholders: {
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        time: expect.stringMatching(/^\d{2}:\d{2}$/),
      },
    });
  });

  it('lets a daily note go from its day, and offers that only on a daily note', async () => {
    const calls = mockFetch(
      baseRoutes({
        'GET /api/notes/n1': { body: note({ title: '2026-11-21', dailyDate: '2026-11-21' }) },
        'DELETE /api/notes/n1/daily': { body: note({ title: '2026-11-21', dailyDate: null }) },
      }),
    );
    renderEditor();
    await userEvent.click(await screen.findByRole('button', { name: 'Not the daily note' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Not the daily note' })).not.toBeInTheDocument());
    expect(calls.filter((call) => call.method === 'DELETE').map((call) => call.url)).toEqual(['/api/notes/n1/daily']);
    // Nothing of the text was sent.
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
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
