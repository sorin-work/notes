import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { mockFetch, renderWithProviders } from '../test/render';
import { SharedNotePage } from './SharedNotePage';

function renderShared() {
  return renderWithProviders(
    <Routes>
      <Route path="/s/:token" element={<SharedNotePage />} />
    </Routes>,
    { route: '/s/tok123' },
  );
}

describe('SharedNotePage', () => {
  it('renders the shared note without links to private notes', async () => {
    const calls = mockFetch({
      'GET /api/public/notes/tok123': {
        body: {
          title: 'Sourdough bread',
          content: '## Method\n\nFeed the [[Starter feeding schedule]]\n\n- [ ] Buy rye flour',
          tags: ['baking'],
          updatedAt: '2026-01-02T10:00:00Z',
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

  it('explains when the link no longer works', async () => {
    mockFetch({});
    renderShared();
    expect(await screen.findByRole('heading', { name: 'This note is not shared' })).toBeInTheDocument();
  });

  const bread = {
    title: 'Sourdough bread',
    content: 'Feed the starter.',
    tags: [],
    updatedAt: '2026-01-02T10:00:00Z',
  };
  const needsPassword = {
    status: 403,
    body: {
      statusCode: 403,
      error: 'Forbidden',
      message: 'This note is protected by a password',
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

    expect(await screen.findByRole('heading', { name: 'This note needs a password' })).toBeInTheDocument();
    expect(screen.queryByText('Feed the starter.')).not.toBeInTheDocument();
    await expectNoAxeViolations();

    await userEvent.type(screen.getByLabelText('Password'), 'open says me');
    await userEvent.click(screen.getByRole('button', { name: 'Show the note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That password is not right.');
    expect(screen.queryByText('Feed the starter.')).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Password'));
    await userEvent.type(screen.getByLabelText('Password'), 'open sesame');
    await userEvent.click(screen.getByRole('button', { name: 'Show the note' }));

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
    await userEvent.click(screen.getByRole('button', { name: 'Show the note' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts on this link');

    answer = { status: 404, body: { message: 'This link does not exist or is no longer shared' } };
    await userEvent.click(screen.getByRole('button', { name: 'Show the note' }));
    expect(await screen.findByRole('heading', { name: 'This note is not shared' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('passes the axe checks, with read-only task boxes in the note', async () => {
    mockFetch({
      'GET /api/public/notes/tok123': {
        body: {
          title: 'Sourdough bread',
          content: '## Method\n\n- [x] Feed the starter\n- [ ] Bake',
          tags: ['baking'],
          updatedAt: '2026-01-02T10:00:00Z',
        },
      },
    });
    renderShared();
    expect(await screen.findByRole('checkbox', { name: 'Bake' })).toBeDisabled();
    await expectNoAxeViolations();
  });
});
