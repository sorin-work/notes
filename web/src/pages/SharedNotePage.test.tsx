import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetShareAccess } from '../api/shares';
import { expectNoAxeViolations } from '../test/axe';
import { mockFetch, renderWithProviders } from '../test/render';
import { ATTACHMENT_REFRESH_MS, SharedNotePage } from './SharedNotePage';

function renderShared(route = '/s/tok123') {
  return renderWithProviders(
    <Routes>
      <Route path="/s/:token" element={<SharedNotePage />} />
      <Route path="/s/:token/:noteId" element={<SharedNotePage />} />
    </Routes>,
    { route },
  );
}

// The proof of a password is kept in the module, as it is in the page.
afterEach(forgetShareAccess);

describe('SharedNotePage', () => {
  it('renders the shared note without links to private notes', async () => {
    const calls = mockFetch({
      'GET /api/public/notes/tok123': {
        body: {
          kind: 'note',
          title: 'Sourdough bread',
          content: '## Method\n\nFeed the [[Starter feeding schedule]]\n\n- [ ] Buy rye flour',
          tags: ['baking'],
          updatedAt: '2026-01-02T10:00:00Z',
          links: {},
        },
      },
    });
    renderShared();

    expect(await screen.findByRole('heading', { name: 'Sourdough bread' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Method' })).toBeInTheDocument();
    expect(screen.getByText('Starter feeding schedule').tagName).toBe('SPAN');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText(/#baking/)).toBeInTheDocument();
    expect(calls[0]?.url).toBe('/api/public/notes/tok123');
  });

  it('asks for new addresses of its images before they run out, without counting a view', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const id = '6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e';
    let round = 0;
    const calls = mockFetch({
      'GET /api/public/notes/tok123': {
        body: {
          kind: 'note',
          title: 'Album',
          content: `![Beach](attachment:${id})`,
          tags: [],
          updatedAt: '2026-01-02T10:00:00Z',
          links: {},
          attachments: { [id]: '/api/attachments/first' },
        },
      },
      'GET /api/public/notes/tok123/attachments': () => ({ body: { [id]: `/api/attachments/fresh-${++round}` } }),
    });
    renderShared();

    expect(await screen.findByRole('img', { name: 'Beach' })).toHaveAttribute('src', '/api/attachments/first');
    await vi.advanceTimersByTimeAsync(ATTACHMENT_REFRESH_MS + 1000);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Beach' })).toHaveAttribute('src', '/api/attachments/fresh-1'),
    );
    // The note itself, which counts the view, was asked for once.
    expect(calls.filter((call) => call.url.endsWith('/api/public/notes/tok123'))).toHaveLength(1);
    vi.useRealTimers();
  });

  it('explains when the link no longer works', async () => {
    mockFetch({});
    renderShared();
    expect(await screen.findByRole('heading', { name: 'This is not shared' })).toBeInTheDocument();
  });

  const bread = {
    kind: 'note',
    title: 'Sourdough bread',
    content: 'Feed the starter.',
    tags: [],
    updatedAt: '2026-01-02T10:00:00Z',
    links: {},
  };
  const needsPassword = {
    status: 403,
    body: {
      statusCode: 403,
      error: 'Forbidden',
      message: 'This link is protected by a password',
      passwordRequired: true,
    },
  };

  it('asks for the password of a protected link and sends it in the body, not in the address', async () => {
    const calls = mockFetch({
      'GET /api/public/notes/tok123': needsPassword,
      'POST /api/public/notes/tok123': ({ body }) =>
        (body as { password: string }).password === 'open sesame' ? { body: bread } : needsPassword,
    });
    renderShared();

    expect(await screen.findByRole('heading', { name: 'This link needs a password' })).toBeInTheDocument();
    expect(screen.queryByText('Feed the starter.')).not.toBeInTheDocument();
    await expectNoAxeViolations();

    await userEvent.type(screen.getByLabelText('Password'), 'open says me');
    await userEvent.click(screen.getByRole('button', { name: 'Show it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not right.');
    expect(screen.queryByText('Feed the starter.')).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'open sesame');
    await userEvent.click(screen.getByRole('button', { name: 'Show it' }));

    expect(await screen.findByRole('heading', { name: 'Sourdough bread' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    // Nothing of the refusals is left on the page: not the wrong password, not the first "needs a password".
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/protected by a password/)).not.toBeInTheDocument();
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts.map((call) => call.body)).toEqual([{ password: 'open says me' }, { password: 'open sesame' }]);
    expect(calls.every((call) => !call.url.includes('open'))).toBe(true);
    // One look at the link, then only the attempts: nothing is retried behind the reader's back.
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(1);
  });

  it('starts over for another link: neither the note nor the password of the last one is carried along', async () => {
    const calls = mockFetch({
      'GET /api/public/notes/tok123': needsPassword,
      'POST /api/public/notes/tok123': { body: bread },
      'GET /api/public/notes/tok456': needsPassword,
      'POST /api/public/notes/tok456': needsPassword,
    });
    renderWithProviders(
      <>
        <Link to="/s/tok456">Another link</Link>
        <Routes>
          <Route path="/s/:token" element={<SharedNotePage />} />
        </Routes>
      </>,
      { route: '/s/tok123' },
    );

    await userEvent.type(await screen.findByLabelText('Password'), 'open sesame');
    await userEvent.click(screen.getByRole('button', { name: 'Show it' }));
    expect(await screen.findByText('Feed the starter.')).toBeInTheDocument();

    // A move inside the app, without a reload, to a link with a password of its own.
    await userEvent.click(screen.getByRole('link', { name: 'Another link' }));

    expect(await screen.findByRole('heading', { name: 'This link needs a password' })).toBeInTheDocument();
    expect(screen.queryByText('Feed the starter.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sourdough bread' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(calls.filter((call) => call.url.endsWith('tok456')).map((call) => call.method)).toEqual(['GET']);
  });

  it('says when there were too many attempts, and when the link went away in the meantime', async () => {
    let answer: { status: number; body: object } = {
      status: 429,
      body: { message: 'ThrottlerException: Too Many Requests' },
    };
    mockFetch({
      'GET /api/public/notes/tok123': needsPassword,
      'POST /api/public/notes/tok123': () => answer,
    });
    renderShared();

    await userEvent.type(await screen.findByLabelText('Password'), 'open sesame');
    await userEvent.click(screen.getByRole('button', { name: 'Show it' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts on this link');

    answer = { status: 404, body: { message: 'This link does not exist or is no longer shared' } };
    await userEvent.click(screen.getByRole('button', { name: 'Show it' }));
    expect(await screen.findByRole('heading', { name: 'This is not shared' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  const recipes = {
    kind: 'notebook',
    name: 'Recipes',
    notes: [
      { id: 'n-soup', title: 'Soup', updatedAt: '2026-01-02T10:00:00Z', notebook: null },
      { id: 'n-rye', title: 'Rye', updatedAt: '2026-01-02T10:00:00Z', notebook: 'Bread' },
    ],
  };
  const rye = {
    kind: 'note',
    title: 'Rye',
    content: 'Goes with [[soup]]. See the plan and [[Somewhere else]].',
    tags: [],
    updatedAt: '2026-01-02T10:00:00Z',
    links: { soup: '/s/tok123/n-soup' },
  };
  const soup = { ...rye, title: 'Soup', content: 'Leeks.', links: {} };

  it('lists the notes of a shared notebook and opens them, following links between them', async () => {
    const calls = mockFetch({
      'GET /api/public/notes/tok123': { body: recipes },
      'GET /api/public/notes/tok123/n-rye': { body: rye },
      'GET /api/public/notes/tok123/n-soup': { body: soup },
    });
    renderShared();

    expect(await screen.findByRole('heading', { name: 'Recipes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Soup' })).toHaveAttribute('href', '/s/tok123/n-soup');
    expect(
      within(screen.getByRole('region', { name: 'Bread' })).getByRole('link', { name: 'Rye' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations();

    await userEvent.click(screen.getByRole('link', { name: 'Rye' }));
    expect(await screen.findByRole('heading', { name: 'Rye' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All notes shared here' })).toHaveAttribute('href', '/s/tok123');
    // A link the API did not vouch for is plain text, whatever the text says.
    expect(screen.getByText('Somewhere else').tagName).toBe('SPAN');

    await userEvent.click(screen.getByRole('link', { name: 'soup' }));
    expect(await screen.findByRole('heading', { name: 'Soup' })).toBeInTheDocument();
    expect(calls.map((call) => call.url)).toEqual([
      '/api/public/notes/tok123',
      '/api/public/notes/tok123/n-rye',
      '/api/public/notes/tok123/n-soup',
    ]);
  });

  it('asks once for the password of a shared notebook and reads on with the proof of it', async () => {
    const sentProof = (call: number) =>
      new Headers((vi.mocked(fetch).mock.calls[call]?.[1] as RequestInit).headers).get('X-Share-Access');
    const calls = mockFetch({
      'GET /api/public/notes/tok123/n-rye': () =>
        sentProof(calls.length - 1) === 'proof-1' ? { body: rye } : needsPassword,
      'POST /api/public/notes/tok123': { body: { ...recipes, access: 'proof-1' } },
      'GET /api/public/notes/tok123': { body: recipes },
    });
    renderShared('/s/tok123/n-rye');

    await userEvent.type(await screen.findByLabelText('Password'), 'open sesame');
    await userEvent.click(screen.getByRole('button', { name: 'Show it' }));

    // Straight to the note that was asked for, with the proof and not the password.
    expect(await screen.findByRole('heading', { name: 'Rye' })).toBeInTheDocument();
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'GET /api/public/notes/tok123/n-rye',
      'POST /api/public/notes/tok123',
      'GET /api/public/notes/tok123/n-rye',
    ]);
    expect(calls[1]?.body).toEqual({ password: 'open sesame' });
    expect(sentProof(0)).toBeNull();
    expect(sentProof(2)).toBe('proof-1');
    // The index came with the answer to the password, so it is there at once.
    await userEvent.click(screen.getByRole('link', { name: 'All notes shared here' }));
    expect(await screen.findByRole('heading', { name: 'Recipes' })).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('says so when a note is no longer in the shared notebook', async () => {
    mockFetch({ 'GET /api/public/notes/tok123': { body: recipes } });
    renderShared('/s/tok123/n-gone');

    expect(await screen.findByRole('heading', { name: 'This is not shared' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See what else is shared here' })).toHaveAttribute('href', '/s/tok123');
  });

  it('passes the axe checks, with read-only task boxes in the note', async () => {
    mockFetch({
      'GET /api/public/notes/tok123': {
        body: {
          kind: 'note',
          title: 'Sourdough bread',
          content: '## Method\n\n- [x] Feed the starter\n- [ ] Bake',
          tags: ['baking'],
          updatedAt: '2026-01-02T10:00:00Z',
          links: {},
        },
      },
    });
    renderShared();
    expect(await screen.findByRole('checkbox', { name: 'Bake' })).toBeDisabled();
    await expectNoAxeViolations();
  });
});
