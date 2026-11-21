import { QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { summary } from '../test/fixtures';
import { renderWithProviders } from '../test/render';
import { NoteList } from './NoteList';

describe('NoteList', () => {
  it('shows titles, flags and tags and keeps the current filter in links', () => {
    renderWithProviders(
      <NoteList
        notes={[
          summary({ id: 'a', title: 'Pinned one', pinned: true, tags: ['work', 'q1'] }),
          summary({ id: 'b', title: 'Favourite', favorite: true }),
        ]}
        activeId="b"
      />,
      { route: '/notes?tag=work' },
    );

    const pinned = screen.getByRole('link', { name: /Pinned one/ });
    expect(pinned).toHaveAttribute('href', '/notes/a?tag=work');
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('#q1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Favourite/ })).toHaveAttribute('aria-current', 'page');
  });

  it('moves the focus from note to note with the arrow keys, Home and End', async () => {
    const notes = ['First', 'Second', 'Third'].map((title) => summary({ id: title, title }));
    renderWithProviders(<NoteList notes={notes} />);
    const link = (name: string) => screen.getByRole('link', { name: new RegExp(name) });

    link('First').focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(link('Second')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(link('Third')).toHaveFocus();
    // There is nothing below the last note, so the focus stays.
    await userEvent.keyboard('{ArrowDown}');
    expect(link('Third')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(link('First')).toHaveFocus();
    await userEvent.keyboard('{End}{Home}');
    expect(link('First')).toHaveFocus();
  });

  it('is one Tab stop: the open note, else the first, else where the focus was last', async () => {
    const notes = ['First', 'Second', 'Third'].map((title) => summary({ id: title, title }));
    const link = (name: string) => screen.getByRole('link', { name: new RegExp(name) });
    const stops = () => screen.getAllByRole('link').filter((item) => item.tabIndex === 0);

    const { rerender: rerenderBare, queryClient } = renderWithProviders(
      <>
        <button type="button">Before</button>
        <NoteList notes={notes} activeId="Second" />
        <button type="button">After</button>
      </>,
    );
    // The same providers as the first render, so that the list stays mounted.
    const rerender = (ui: ReactElement) =>
      rerenderBare(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/']}>{ui}</MemoryRouter>
        </QueryClientProvider>,
      );
    expect(stops()).toEqual([link('Second')]);
    screen.getByRole('button', { name: 'Before' }).focus();
    await userEvent.tab();
    expect(link('Second')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();

    // Where the arrows left the focus is where Tab comes back to, also after the list reloads.
    link('Second').focus();
    await userEvent.keyboard('{ArrowDown}');
    const reloaded = notes.map((note) => ({ ...note }));
    rerender(
      <>
        <button type="button">Before</button>
        <NoteList notes={reloaded} activeId="Second" />
        <button type="button">After</button>
      </>,
    );
    expect(stops()).toEqual([link('Third')]);

    // Without that note in the list, and with no note open, it is the first one.
    rerender(<NoteList notes={reloaded.slice(0, 2)} />);
    expect(stops()).toEqual([link('First')]);
  });

  it('selects with a box, Shift with a click, Space and Shift with the arrow keys', async () => {
    const notes = ['First', 'Second', 'Third'].map((title) => summary({ id: title, title }));
    const onToggle = vi.fn();
    renderWithProviders(<NoteList notes={notes} selection={{ selected: new Set(['Second']), onToggle }} />);

    expect(screen.getByRole('list')).toHaveAttribute('aria-multiselectable', 'true');
    expect(screen.getByRole('checkbox', { name: 'Select “Second”' })).toBeChecked();
    expect(screen.getByRole('link', { name: /Second/ })).toHaveAccessibleDescription('Selected');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select “First”' }));
    expect(onToggle).toHaveBeenLastCalledWith('First', false);
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select “Third”' }));
    await user.keyboard('{/Shift}');
    expect(onToggle).toHaveBeenLastCalledWith('Third', true);

    screen.getByRole('link', { name: /First/ }).focus();
    await userEvent.keyboard(' ');
    expect(onToggle).toHaveBeenLastCalledWith('First', false);
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(screen.getByRole('link', { name: /Second/ })).toHaveFocus();
    expect(onToggle).toHaveBeenLastCalledWith('Second', true);
  });
});
