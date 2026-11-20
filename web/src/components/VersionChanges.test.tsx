import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VersionChanges } from './VersionChanges';

const paragraphs = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}`);

describe('VersionChanges', () => {
  it('shows removed and added lines and counts the unchanged ones around them', () => {
    const version = { title: 'Atlas', content: [...paragraphs, 'The lost paragraph'].join('\n') };
    const current = { title: 'Project Atlas', content: [...paragraphs, 'A new ending'].join('\n') };
    render(<VersionChanges version={version} current={current} />);

    const removed = screen.getByText('The lost paragraph').closest('.diff-line');
    expect(removed).toHaveClass('diff-removed');
    expect(removed).toHaveTextContent('-Removed: The lost paragraph');
    const added = screen.getByText('A new ending').closest('.diff-line');
    expect(added).toHaveClass('diff-added');
    expect(added).toHaveTextContent('+Added: A new ending');

    expect(screen.getByText('9 unchanged lines')).toBeInTheDocument();
    expect(screen.queryByText('Paragraph 9')).not.toBeInTheDocument();
    expect(screen.getByText('Paragraph 10').closest('.diff-line')).toHaveClass('diff-same');
    expect(screen.getByText(/The title changed/)).toHaveTextContent(
      'The title changed from “Atlas” to “Project Atlas”.',
    );
  });

  it('says so when nothing changed', () => {
    const note = { title: 'Atlas', content: paragraphs.join('\n') };
    const { container } = render(<VersionChanges version={note} current={note} />);
    expect(screen.getByText('The text of this version is the same as the note now.')).toBeInTheDocument();
    expect(screen.queryByText(/The title changed/)).not.toBeInTheDocument();
    expect(container.querySelector('.diff')).toBeNull();
  });

  it('falls back to a message when a long note changed from top to bottom', () => {
    const long = (word: string) => Array.from({ length: 3_500 }, (_, index) => `${word} ${index}`).join('\n');
    const { container } = render(
      <VersionChanges
        version={{ title: 'Log', content: long('old') }}
        current={{ title: 'Log', content: long('new') }}
      />,
    );
    expect(screen.getByText(/Too much has changed in this long note/)).toBeInTheDocument();
    expect(container.querySelector('.diff')).toBeNull();
  });
});
