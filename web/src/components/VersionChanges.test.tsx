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

  it('falls back to a message when more lines changed than it compares', () => {
    const long = (word: string) => Array.from({ length: 1_100 }, (_, index) => `${word} ${index}`).join('\n');
    const { container } = render(
      <VersionChanges
        version={{ title: 'Log', content: long('old') }}
        current={{ title: 'Log', content: long('new') }}
      />,
    );
    expect(screen.getByText(/More than 2,000 lines differ/)).toBeInTheDocument();
    expect(container.querySelector('.diff')).toBeNull();
  });

  it('stops after a few thousand rows and says how many more lines changed', () => {
    const entries = Array.from({ length: 2_500 }, (_, index) => `Entry ${index + 1}`).join('\n');
    const { container } = render(
      <VersionChanges
        version={{ title: 'Log', content: `# Log\n${entries}` }}
        current={{ title: 'Log', content: '# Log' }}
      />,
    );
    expect(container.querySelectorAll('.diff-line')).toHaveLength(2_000);
    expect(screen.getByText('Entry 1999')).toBeInTheDocument();
    expect(screen.queryByText('Entry 2000')).not.toBeInTheDocument();
    expect(screen.getByText('501 more changed lines are not shown')).toBeInTheDocument();
  });
});
