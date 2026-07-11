import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { notebook, user } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { Sidebar } from './Sidebar';

function renderSidebar(route = '/notes') {
  setToken('tok');
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="*" element={<Sidebar />} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

const notebooks = [
  notebook({ id: 'w', name: 'Work', noteCount: 1 }),
  notebook({ id: 'm', name: 'Meetings', parentId: 'w', noteCount: 2 }),
  notebook({ id: 'p', name: 'Personal', noteCount: 0 }),
];

describe('Sidebar', () => {
  it('shows notebooks nested under their parent with note counts', async () => {
    mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [{ id: 't', name: 'atlas', noteCount: 4 }] },
    });
    renderSidebar('/notes?notebook=m');

    const work = await screen.findByRole('link', { name: /Work/ });
    expect(work).toHaveTextContent('3');
    const meetings = screen.getByRole('link', { name: /Meetings/ });
    expect(meetings).toHaveAttribute('aria-current', 'page');
    expect(meetings.closest('ul')?.closest('li')).toContainElement(work);
    expect(screen.getByRole('link', { name: /#atlas/ })).toHaveAttribute('href', '/notes?tag=atlas');
  });

  it('warns before deleting a notebook that its notes go to the trash', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'DELETE /api/notebooks/w': { body: { trashedNotes: 3 } },
    });
    renderSidebar();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete Work' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('and the notebooks inside it');
    expect(dialog).toHaveTextContent('notes move to the trash');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete notebook' }));
    expect(calls.some((call) => call.method === 'DELETE' && call.url === '/api/notebooks/w')).toBe(true);
  });

  it('creates a notebook inside another one', async () => {
    const calls = mockFetch({
      'GET /api/auth/me': { body: user },
      'GET /api/notebooks': { body: notebooks },
      'GET /api/tags': { body: [] },
      'POST /api/notebooks': { status: 201, body: notebook({ id: 'new', name: 'Ideas', parentId: 'p' }) },
    });
    renderSidebar();

    await userEvent.click(await screen.findByRole('button', { name: 'New notebook inside Personal' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Ideas');
    expect(screen.getByLabelText('Inside')).toHaveValue('p');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ name: 'Ideas', parentId: 'p' });
  });
});
