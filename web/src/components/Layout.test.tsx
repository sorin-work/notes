import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { NotesPage } from '../pages/NotesPage';
import { expectNoAxeViolations } from '../test/axe';
import { note, summary, user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { Layout } from './Layout';

function renderLayout(route: string) {
  setToken('tok');
  localStorage.setItem('notes.editorMode', 'split');
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/notes/:noteId" element={<NotesPage />} />
        </Route>
      </Routes>
    </AuthProvider>,
    { route },
  );
}

const atlas = note({ id: 'n1', title: 'Project Atlas', content: 'Plans.' });
const review = note({ id: 'n2', title: 'Weekly review', content: 'Went well.' });
const titles = [atlas, review].map(({ id, title }) => ({ id, title }));

const routes = {
  'GET /api/auth/me': { body: user },
  'GET /api/notebooks': { body: [] },
  'GET /api/tags': { body: [] },
  'GET /api/notes': { body: { items: [summary(atlas), summary(review)], total: 2, page: 1, pageSize: 50 } },
  'GET /api/notes/titles': { body: titles },
  'GET /api/notes/n1': { body: atlas },
  'GET /api/notes/n1/links': { body: [] },
  'GET /api/notes/n1/backlinks': { body: [] },
  'GET /api/notes/n2': { body: review },
  'GET /api/notes/n2/links': { body: [] },
  'GET /api/notes/n2/backlinks': { body: [] },
};

describe('Layout', () => {
  it('opens the quick switcher with Ctrl+K while typing, and Enter lands in the chosen note', async () => {
    mockFetch(routes);
    renderLayout('/notes/n1');

    await userEvent.click(await screen.findByLabelText('Note content'));
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'Go to note' })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('combobox', { name: 'Note title' }), 'wee{Enter}');

    expect(await screen.findByDisplayValue('Went well.')).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Weekly review');
  });

  it('closes the switcher with the same key, once however long it is held', async () => {
    mockFetch(routes);
    renderLayout('/notes');

    const search = await screen.findByLabelText('Search notes');
    await userEvent.click(search);
    await userEvent.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Note title' });
    expect(input).toHaveFocus();

    // A repeat of the held key is swallowed and changes nothing.
    expect(fireEvent.keyDown(input, { key: 'k', ctrlKey: true, repeat: true })).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Go to note' })).toBeInTheDocument();

    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(search).toHaveFocus());
  });

  it('leaves the key to the browser while another dialog is open', async () => {
    mockFetch(routes);
    renderLayout('/notes');

    await userEvent.click(await screen.findByRole('button', { name: 'New notebook' }));
    expect(fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })).toBe(true);
    expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Note title' })).not.toBeInTheDocument();
  });

  it('takes Cmd+K on a Mac, where Ctrl+K belongs to the text field', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    mockFetch(routes);
    renderLayout('/notes');

    const search = await screen.findByLabelText('Search notes');
    await userEvent.click(search);
    expect(fireEvent.keyDown(search, { key: 'k', ctrlKey: true })).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('dialog', { name: 'Go to note' })).toBeInTheDocument();
  });

  it('offers skip links to the content and to the open note', async () => {
    mockFetch(routes);
    renderLayout('/notes/n1');
    await screen.findByLabelText('Note content');

    // The first stop of Tab on the page.
    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();

    await userEvent.click(screen.getByRole('link', { name: 'Skip to the note' }));
    expect(screen.getByLabelText('Note editor').closest('section')).toHaveFocus();
  });

  it('has no link to a note when none is open', async () => {
    mockFetch(routes);
    renderLayout('/notes');
    expect(await screen.findByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Skip to the note' })).not.toBeInTheDocument();
  });

  it('passes the axe checks with a note open, in the quick switcher and in a dialog', async () => {
    const tasks = note({ id: 'n1', title: 'Project Atlas', content: '# Plans\n\n- [ ] Draft\n- [x] Budget' });
    mockFetch({
      ...routes,
      'GET /api/notes/n1': { body: tasks },
      'GET /api/notes/n1/backlinks': {
        body: [
          { id: 'n2', title: 'Weekly review', updatedAt: '2026-01-02T10:00:00Z', context: 'See [[Project Atlas]]' },
        ],
      },
    });
    renderLayout('/notes/n1');
    expect(await screen.findByRole('checkbox', { name: 'Draft' })).toBeInTheDocument();
    await screen.findByText('See [[Project Atlas]]');
    await expectNoAxeViolations();

    await userEvent.keyboard('{Control>}k{/Control}');
    await screen.findByRole('option', { name: 'Weekly review' });
    await expectNoAxeViolations();
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: 'New notebook' }));
    expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
    await expectNoAxeViolations();
  });
});
