import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
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

function renderEditor() {
  localStorage.setItem('notes.editorMode', 'split');
  return renderWithProviders(
    <Routes>
      <Route path="/notes/:noteId" element={<NoteEditor noteId="n1" />} />
      <Route path="/notes/:noteId" element={<div />} />
    </Routes>,
    { route: '/notes/n1' },
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

  it('shows notes in the trash as read-only', async () => {
    mockFetch(baseRoutes({ 'GET /api/notes/n1': { body: note({ deletedAt: '2026-01-03T00:00:00Z' }) } }));
    renderEditor();
    expect(await screen.findByText(/This note is in the trash/)).toBeInTheDocument();
    expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('explains when the note does not exist', async () => {
    mockFetch({ 'GET /api/notes/n1': { status: 404, body: { message: 'Note not found' } } });
    renderEditor();
    expect(await screen.findByText(/This note does not exist/)).toBeInTheDocument();
  });
});
