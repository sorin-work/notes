import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { setToken } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import { InvitePage } from '../pages/InvitePage';
import { expectNoAxeViolations } from '../test/axe';
import { note, notebook, user, userToken } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { MembersDialog } from './MembersDialog';
import { NoteEditor } from './NoteEditor';
import { Sidebar } from './Sidebar';

function Where() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

const signedIn = { 'GET /api/auth/me': { body: user }, 'GET /api/tags': { body: [] } };
const shared = notebook({ id: 'k', name: 'Kitchen', access: 'edit', owner: { name: 'Ada' }, noteCount: 2 });

function renderSidebar() {
  setToken(userToken);
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <Sidebar />
              <Where />
            </>
          }
        />
      </Routes>
    </AuthProvider>,
    { route: '/notes' },
  );
}

describe('notebooks shared with other accounts', () => {
  it('lists what others share apart from your own, and lets you leave', async () => {
    const calls = mockFetch({
      ...signedIn,
      'GET /api/notebooks': { body: [notebook({ id: 'w', name: 'Work', memberCount: 2 }), shared] },
      'GET /api/invites': { body: [] },
      [`DELETE /api/notebooks/k/members/${user.id}`]: { status: 204 },
    });
    renderSidebar();
    expect(await screen.findByText('Shared with me')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Kitchen/ })).toHaveAttribute('href', '/notes?notebook=k');
    expect(screen.getByTitle('Ada shares this with you to edit')).toHaveTextContent('edit');
    // Your own notebook says it is shared, and with how many.
    expect(screen.getByRole('button', { name: 'Share Work with people' })).toHaveAttribute(
      'title',
      'Shared with 2 people',
    );
    // A shared notebook cannot be renamed, deleted or shared on by a member.
    expect(screen.queryByRole('button', { name: 'Delete Kitchen' })).not.toBeInTheDocument();
    await expectNoAxeViolations({ part: true });

    await userEvent.click(screen.getByRole('button', { name: 'Leave Kitchen' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Leave' }));
    await waitFor(() =>
      expect(calls.some((call) => call.method === 'DELETE' && call.url === `/api/notebooks/k/members/${user.id}`)).toBe(
        true,
      ),
    );
  });

  it('shows invitations to accept or decline, and opens the notebook once accepted', async () => {
    const calls = mockFetch({
      ...signedIn,
      'GET /api/notebooks': { body: [] },
      'GET /api/invites': {
        body: [
          { id: 'i1', notebook: { id: 'k', name: 'Kitchen' }, from: { name: 'Ada' }, role: 'read', expiresAt: '' },
        ],
      },
      'POST /api/invites/i1/accept': { body: { notebookId: 'k' } },
    });
    renderSidebar();
    expect(await screen.findByText('Ada invited you to “Kitchen”, to read.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/notes?notebook=k'));
    expect(calls.some((call) => call.url === '/api/invites/i1/accept')).toBe(true);
  });

  it('lets the owner invite by email with a role, change roles and remove members', async () => {
    const calls = mockFetch({
      'GET /api/notebooks/w/members': {
        body: {
          owner: { name: 'Demo User' },
          members: [{ userId: 'u2', name: 'Bo', email: 'bo@example.com', role: 'read', since: '' }],
          invites: [{ id: 'i1', email: 'cy@example.com', role: 'edit', expiresAt: '2026-11-27T10:00:00Z' }],
        },
      },
      'POST /api/notebooks/w/members/invites': { status: 201, body: { id: 'i2' } },
      'PATCH /api/notebooks/w/members/u2': { status: 204 },
      'DELETE /api/notebooks/w/members/u2': { status: 204 },
      'DELETE /api/notebooks/w/members/invites/i1': { status: 204 },
    });
    renderWithProviders(<MembersDialog notebookId="w" name="Work" onClose={() => undefined} />);
    expect(await screen.findByText('bo@example.com')).toBeInTheDocument();
    await expectNoAxeViolations({ part: true });

    await userEvent.type(screen.getByLabelText('Invite by email'), 'dee@example.com');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'edit');
    await userEvent.click(screen.getByRole('button', { name: 'Invite' }));
    await userEvent.selectOptions(screen.getByLabelText('Role of Bo'), 'edit');
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw the invitation to cy@example.com' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove Bo' }));
    await waitFor(() => expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(4));
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ email: 'dee@example.com', role: 'edit' });
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ role: 'edit' });
  });

  it('accepts the invitation from the mailed link once signed in, and opens the notebook', async () => {
    const calls = mockFetch({ ...signedIn, 'POST /api/invites/accept': { body: { notebookId: 'k' } } });
    setToken(userToken);
    window.history.replaceState(null, '', '/invites#token=abc');
    renderWithProviders(
      <AuthProvider>
        <Routes>
          <Route path="/invites" element={<InvitePage />} />
          <Route path="/notes" element={<Where />} />
        </Routes>
      </AuthProvider>,
      { route: '/invites' },
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/notes?notebook=k'));
    expect(calls.find((call) => call.url === '/api/invites/accept')?.body).toEqual({ token: 'abc' });
  });

  describe('a note in a notebook shared with you', () => {
    const routes = (access: 'read' | 'edit') => ({
      ...signedIn,
      'GET /api/notebooks': { body: [shared] },
      'GET /api/notes/n1': { body: note({ notebookId: 'k', access }) },
      'GET /api/notes/n1/links': { body: [] },
      'GET /api/notes/n1/backlinks': { body: [] },
      'GET /api/notes/n1/attachments': { body: [] },
    });
    const renderEditor = () => {
      setToken(userToken);
      localStorage.setItem('notes.editorMode', 'split');
      return renderWithProviders(
        <AuthProvider>
          <Routes>
            <Route path="/notes/:noteId" element={<NoteEditor noteId="n1" />} />
          </Routes>
        </AuthProvider>,
        { route: '/notes/n1' },
      );
    };

    it('is read only to a reader', async () => {
      mockFetch(routes('read'));
      renderEditor();
      expect(await screen.findByText('This note is in a notebook shared with you to read.')).toBeInTheDocument();
      expect(screen.getByLabelText('Note content')).toHaveAttribute('readonly');
      expect(screen.getByLabelText('Title')).toHaveAttribute('readonly');
    });

    it('lets an editor change the text, keeps the owner’s controls back, and looks up links in that notebook', async () => {
      const calls = mockFetch({ ...routes('edit'), 'GET /api/notes/titles': { body: [] } });
      renderEditor();
      const textarea = await screen.findByLabelText('Note content');
      expect(textarea).not.toHaveAttribute('readonly');
      expect(screen.getByRole('button', { name: 'Pin' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Template' })).toBeDisabled();
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
      await userEvent.clear(textarea);
      await userEvent.type(textarea, 'See [[[[Ry');
      await waitFor(() => expect(calls.some((call) => call.url.startsWith('/api/notes/titles?'))).toBe(true));
      expect(calls.find((call) => call.url.startsWith('/api/notes/titles?'))?.url).toContain('notebookId=k');
    });
  });
});
