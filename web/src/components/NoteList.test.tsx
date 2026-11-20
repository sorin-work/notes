import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
});
