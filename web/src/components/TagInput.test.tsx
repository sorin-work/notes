import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { normalizeTag, TagInput } from './TagInput';

describe('TagInput', () => {
  it('adds a normalised tag on Enter', async () => {
    const onChange = vi.fn();
    render(<TagInput tags={['work']} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Add a tag'), '#Book Club{Enter}');
    expect(onChange).toHaveBeenCalledWith(['work', 'book-club']);
  });

  it('ignores duplicates', async () => {
    const onChange = vi.fn();
    render(<TagInput tags={['work']} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText('Add a tag'), 'Work,');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes tags with the × button or Backspace', async () => {
    const onChange = vi.fn();
    render(<TagInput tags={['a', 'b']} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag a' }));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
    await userEvent.type(screen.getByLabelText('Add a tag'), '{Backspace}');
    expect(onChange).toHaveBeenLastCalledWith(['a']);
  });
});

describe('normalizeTag', () => {
  it('matches the API rules', () => {
    expect(normalizeTag('  ##Read  Later ')).toBe('read-later');
    expect(normalizeTag('-')).toBe('');
  });
});
