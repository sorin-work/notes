import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { NotesPage } from '../pages/NotesPage';
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

  it('closes the switcher with the same key and keeps it shut over another dialog', async () => {
    mockFetch(routes);
    renderLayout('/notes');

    const search = await screen.findByLabelText('Search notes');
    await userEvent.click(search);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('combobox', { name: 'Note title' })).toHaveFocus();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(search).toHaveFocus());

    await userEvent.click(screen.getByRole('button', { name: 'New notebook' }));
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(screen.getByRole('dialog', { name: 'New notebook' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Note title' })).not.toBeInTheDocument();
  });
});
