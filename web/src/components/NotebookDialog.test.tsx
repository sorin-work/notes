import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { notebook } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { NotebookDialog } from './NotebookDialog';

// Work holds four levels, which is as deep as notebooks go.
const notebooks = [
  notebook({ id: 'w', name: 'Work' }),
  notebook({ id: 'm', name: 'Meetings', parentId: 'w' }),
  notebook({ id: 'o', name: 'One-to-ones', parentId: 'm' }),
  notebook({ id: 'y', name: '2026', parentId: 'o' }),
  notebook({ id: 'r', name: 'Reading', parentId: 'w' }),
  notebook({ id: 'p', name: 'Personal' }),
];
const byId = (id: string) => notebooks.find((item) => item.id === id);
const places = () =>
  within(screen.getByLabelText('Inside'))
    .getAllByRole('option')
    .map((option) => option.textContent?.trim());

describe('NotebookDialog', () => {
  it('offers every notebook that has room for a new one inside it', async () => {
    mockFetch({});
    renderWithProviders(<NotebookDialog notebooks={notebooks} parentId="o" onClose={() => {}} />);

    // Not 2026: it sits at the last level.
    expect(places()).toEqual(['Top level', 'Personal', 'Work', 'Meetings', 'One-to-ones', 'Reading']);
    const inside = screen.getByLabelText('Inside');
    expect(inside).toHaveValue('o');
    expect(inside).toHaveAccessibleDescription(
      'Notebooks nest 4 levels deep. What is inside a notebook moves with it.',
    );
    await expectNoAxeViolations({ part: true });
  });

  it('does not offer a move into the notebook itself, into what is inside it, or too deep for what it holds', () => {
    mockFetch({});
    const { unmount } = renderWithProviders(
      <NotebookDialog notebooks={notebooks} notebook={byId('m')} onClose={() => {}} />,
    );
    // Meetings holds two more levels, so it only fits at the top or right under a notebook at the top.
    expect(places()).toEqual(['Top level', 'Personal', 'Work']);
    expect(screen.getByLabelText('Inside')).toHaveValue('w');
    unmount();

    renderWithProviders(<NotebookDialog notebooks={notebooks} notebook={byId('r')} onClose={() => {}} />);
    // Reading holds nothing, so it fits anywhere above the last level, except inside itself.
    expect(places()).toEqual(['Top level', 'Personal', 'Work', 'Meetings', 'One-to-ones']);
  });

  it('moves a notebook, with what is inside it, to the place that is picked', async () => {
    const calls = mockFetch({
      'PATCH /api/notebooks/m': { body: notebook({ id: 'm', name: 'Meetings', parentId: 'p' }) },
      'GET /api/notebooks': { body: notebooks },
    });
    const onClose = vi.fn();
    renderWithProviders(<NotebookDialog notebooks={notebooks} notebook={byId('m')} onClose={onClose} />);

    await userEvent.selectOptions(screen.getByLabelText('Inside'), 'p');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ name: 'Meetings', parentId: 'p' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows what the API answers when it refuses a move', async () => {
    mockFetch({
      'PATCH /api/notebooks/r': {
        status: 400,
        body: { statusCode: 400, message: 'Notebooks can be nested 4 levels deep at most' },
      },
    });
    renderWithProviders(<NotebookDialog notebooks={notebooks} notebook={byId('r')} onClose={() => {}} />);

    await userEvent.selectOptions(screen.getByLabelText('Inside'), 'o');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Notebooks can be nested 4 levels deep at most');
  });
});
