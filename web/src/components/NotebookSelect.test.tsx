import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { notebook } from '../test/fixtures';
import { NotebookOptions, NotebookSelect } from './NotebookSelect';

// Four levels under Work, and a second notebook at the top.
const notebooks = [
  notebook({ id: 'w', name: 'Work' }),
  notebook({ id: 'm', name: 'Meetings', parentId: 'w' }),
  notebook({ id: 'o', name: 'One-to-ones', parentId: 'm' }),
  notebook({ id: 'y', name: '2026', parentId: 'o' }),
  notebook({ id: 'r', name: 'Reading', parentId: 'w' }),
  notebook({ id: 'p', name: 'Personal' }),
];

function Picker({ start = null, onChange = () => {} }: { start?: string | null; onChange?(id: string | null): void }) {
  const [value, setValue] = useState<string | null>(start);
  return (
    <main>
      <NotebookSelect
        notebooks={notebooks}
        value={value}
        onChange={(id) => {
          setValue(id);
          onChange(id);
        }}
      />
      <button type="button">After</button>
    </main>
  );
}

const names = (list: HTMLElement) =>
  within(list)
    .getAllByRole('button')
    .filter((button) => button.classList.contains('notebook-option'))
    .map((button) => button.textContent);

describe('NotebookSelect', () => {
  it('shows where the note is, and lists the notebooks as a tree that folds', async () => {
    render(<Picker start="o" />);

    const button = screen.getByRole('button', { name: 'Notebook: Work / Meetings / One-to-ones' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('group', { name: 'Notebook, pick one' });
    expect(button).toHaveAttribute('aria-controls', list.id);
    expect(names(list)).toEqual(['No notebook', 'Personal', 'Work', 'Meetings', 'One-to-ones', '2026', 'Reading']);
    // Nested lists carry the depth: 2026 sits three lists inside the outer one.
    const deepest = within(list).getByRole('button', { name: '2026' });
    expect(deepest.closest('ul')?.parentElement?.closest('ul')?.parentElement?.closest('ul')).not.toBeNull();
    expect(within(list).getByRole('button', { name: 'One-to-ones' })).toHaveAttribute('aria-current', 'true');
    expect(within(list).getByRole('button', { name: 'Work' })).not.toHaveAttribute('aria-current');
    await expectNoAxeViolations();

    const fold = within(list).getByRole('button', { name: 'Fold Meetings' });
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(fold);
    expect(names(list)).toEqual(['No notebook', 'Personal', 'Work', 'Meetings', 'Reading']);
    expect(within(list).getByRole('button', { name: 'Unfold Meetings' })).toHaveAttribute('aria-expanded', 'false');
    // Notebooks with nothing inside have no fold button.
    expect(within(list).queryByRole('button', { name: /Fold Reading|Fold Personal/ })).not.toBeInTheDocument();
    await expectNoAxeViolations();
  });

  it('moves the note to the notebook that is picked, closes, and puts the focus back', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);

    const button = screen.getByRole('button', { name: 'Notebook: No notebook' });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Reading' }));
    expect(onChange).toHaveBeenCalledWith('r');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    const moved = screen.getByRole('button', { name: 'Notebook: Work / Reading' });
    expect(moved).toHaveFocus();

    // Picking what is already picked changes nothing.
    await userEvent.click(moved);
    await userEvent.click(screen.getByRole('button', { name: 'Reading' }));
    expect(onChange).toHaveBeenCalledTimes(1);

    await userEvent.click(moved);
    await userEvent.click(screen.getByRole('button', { name: 'No notebook' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('works with the keyboard alone', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);

    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Notebook: No notebook' })).toHaveFocus();
    // Opening it puts the focus on the choice that stands.
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'No notebook' })).toHaveFocus();
    // From there Tab goes through the list in the order it is read: Personal, the fold button of Work, Work.
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Fold Work' })).toHaveFocus();
    await userEvent.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Unfold Work' })).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Meetings' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'Fold Meetings' })).toHaveFocus();
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('m');
    expect(screen.getByRole('button', { name: 'Notebook: Work / Meetings' })).toHaveFocus();

    // Escape closes the list and keeps the focus on the button. Tabbing out of the list closes it too.
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notebook: Work / Meetings' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    screen.getByRole('button', { name: 'After' }).focus();
    await waitFor(() => expect(screen.queryByRole('group')).not.toBeInTheDocument());
  });

  it('moves and folds with the arrow keys, as the sidebar does', async () => {
    const onChange = vi.fn();
    render(<Picker onChange={onChange} />);
    const option = (name: string) => screen.getByRole('button', { name });

    await userEvent.click(option('Notebook: No notebook'));
    // The focus is in the list at once, so the arrows work straight away.
    expect(option('No notebook')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(option('Work')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(option('Unfold Work')).toBeInTheDocument();
    // The notebook itself says it is folded, so the fold is announced where the focus is.
    expect(option('Work')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Meetings' })).not.toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}{ArrowRight}');
    expect(option('Meetings')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(option('Reading')).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(option('Work')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(option('No notebook')).toHaveFocus();
    await userEvent.keyboard('{End}{Enter}');
    expect(onChange).toHaveBeenCalledWith('r');
  });

  it('remembers what is folded, and unfolds the way to the notebook the note is in', async () => {
    const first = render(<Picker />);
    await userEvent.click(screen.getByRole('button', { name: 'Notebook: No notebook' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fold Work' }));
    expect(JSON.parse(localStorage.getItem('notes.closedNotebooks.select') ?? '[]')).toEqual(['w']);
    // The sidebar keeps its own list of what is folded.
    expect(localStorage.getItem('notes.closedNotebooks')).toBeNull();
    first.unmount();

    const second = render(<Picker />);
    await userEvent.click(screen.getByRole('button', { name: 'Notebook: No notebook' }));
    expect(screen.getByRole('button', { name: 'Unfold Work' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meetings' })).not.toBeInTheDocument();
    second.unmount();

    // A note inside what is folded: opening the list shows the way to it.
    render(<Picker start="o" />);
    await userEvent.click(screen.getByRole('button', { name: 'Notebook: Work / Meetings / One-to-ones' }));
    expect(screen.getByRole('button', { name: 'One-to-ones' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Fold Work' })).toBeInTheDocument();
  });

  it('closes on a click somewhere else, and cannot be opened for a note that cannot be changed', async () => {
    const { rerender } = render(<Picker />);
    await userEvent.click(screen.getByRole('button', { name: 'Notebook: No notebook' }));
    await userEvent.click(document.body);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();

    rerender(<NotebookSelect notebooks={notebooks} value="p" onChange={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Notebook: Personal' })).toBeDisabled();
  });
});

describe('NotebookOptions', () => {
  it('lists every notebook for a select, in the order of the tree and named by its way there', () => {
    render(
      <select aria-label="Filter by notebook">
        <NotebookOptions notebooks={notebooks} />
      </select>,
    );
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Personal',
      'Work',
      'Work / Meetings',
      'Work / Meetings / One-to-ones',
      'Work / Meetings / One-to-ones / 2026',
      'Work / Reading',
    ]);
  });
});
