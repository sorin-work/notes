import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { note, notebook } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { TasksPage } from './TasksPage';

const lists = {
  'GET /api/notebooks': { body: [notebook({ id: 'w', name: 'Work' })] },
  'GET /api/tags': { body: [] },
};

const sync = {
  id: 'n1',
  title: 'Atlas weekly sync',
  updatedAt: '2026-01-02T10:00:00Z',
  notebook: { id: 'w', name: 'Work' },
  revision: 4,
  tasks: [
    { line: 9, text: 'Draft the permissions proposal due:2020-01-31' },
    { line: 10, text: 'Collect five example reports' },
  ],
};
const answer = (overrides = {}) => ({
  notes: [sync],
  unreadable: 0,
  unread: 0,
  capped: false,
  canTick: true,
  ...overrides,
});

function Where() {
  const location = useLocation();
  return <output aria-label="Location">{`${location.pathname} ${JSON.stringify(location.state)}`}</output>;
}

function renderPage(route = '/tasks') {
  return renderWithProviders(
    <>
      <Where />
      <Routes>
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/notes/:noteId" element={<p>The note</p>} />
      </Routes>
    </>,
    { route },
  );
}

describe('TasksPage', () => {
  it('lists open tasks by note, with what is late, and opens a note at the line of a task', async () => {
    const calls = mockFetch({ ...lists, 'GET /api/tasks': { body: answer() } });
    renderPage('/tasks?notebook=w');

    const group = await screen.findByRole('region', { name: 'Atlas weekly sync' });
    expect(
      within(group)
        .getAllByRole('checkbox')
        .map((box) => box.getAttribute('aria-label')),
    ).toEqual(['Draft the permissions proposal due:2020-01-31', 'Collect five example reports']);
    expect(within(group).getByText('late, due 2020-01-31')).toHaveClass('task-late');
    expect(calls.find((call) => call.url.startsWith('/api/tasks'))?.url).toBe('/api/tasks?notebookId=w');
    await expectNoAxeViolations({ part: true });

    await userEvent.click(within(group).getByRole('link', { name: 'Collect five example reports' }));
    expect(screen.getByLabelText('Location')).toHaveTextContent('/notes/n1 {"line":10}');
  });

  it('ticks a task with the revision it was read from, and says so when the note changed', async () => {
    let ticked = false;
    const calls = mockFetch({
      ...lists,
      'GET /api/tasks': () => ({ body: answer(ticked ? { notes: [{ ...sync, tasks: [sync.tasks[1]] }] } : {}) }),
      'POST /api/notes/n1/tasks': ({ body }: { body: unknown }) => {
        if ((body as { line: number }).line === 10) {
          return { status: 409, body: { message: 'Changed', code: 'stale_revision' } };
        }
        ticked = true;
        return { body: note({ id: 'n1', revision: 5 }) };
      },
    });
    renderPage();

    await userEvent.click(await screen.findByRole('checkbox', { name: /Draft the permissions/ }));
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /Draft the permissions/ })).not.toBeInTheDocument(),
    );
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ line: 9, checked: false, revision: 4 });

    await userEvent.click(screen.getByRole('checkbox', { name: 'Collect five example reports' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That note changed since this list was made');
  });

  it('keeps the boxes read-only in a notebook shared to read, and says what it could not read', async () => {
    mockFetch({ ...lists, 'GET /api/tasks': { body: answer({ canTick: false, unreadable: 2, unread: 1 }) } });
    renderPage();
    for (const box of await screen.findAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(screen.getByText(/2 notes are too long or too intricate/)).toBeInTheDocument();
    expect(screen.getByText('1 note has not been read for tasks yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read on' })).toBeInTheDocument();
  });

  it('says when there is nothing to do', async () => {
    mockFetch({ ...lists, 'GET /api/tasks': { body: answer({ notes: [] }) } });
    renderPage();
    expect(await screen.findByText('No open tasks')).toBeInTheDocument();
  });
});
