import { screen } from '@testing-library/react';
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
});
