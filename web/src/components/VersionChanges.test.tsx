import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { VersionChanges } from './VersionChanges';

const paragraphs = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1}`);

describe('VersionChanges', () => {
  it('shows removed and added lines and counts the unchanged ones around them', () => {
    const version = { title: 'Atlas', content: [...paragraphs, 'The lost paragraph'].join('\n') };
    const current = { title: 'Project Atlas', content: [...paragraphs, 'A new ending'].join('\n') };
    render(<VersionChanges from={version} to={current} />);

    const removed = screen.getByText('The lost paragraph').closest('.diff-line');
    expect(removed).toHaveClass('diff-removed');
    expect(removed).toHaveTextContent('-Removed: The lost paragraph');
    const added = screen.getByText('A new ending').closest('.diff-line');
    expect(added).toHaveClass('diff-added');
    expect(added).toHaveTextContent('+Added: A new ending');
    // The sign and the spoken label are kept out of a selection in the stylesheet, by these classes.
    expect(screen.getByText('Added:')).toHaveClass('sr-only', 'diff-label');
    expect(screen.getByText('+')).toHaveClass('diff-sign');

    expect(screen.getByText('9 unchanged lines')).toBeInTheDocument();
    expect(screen.queryByText('Paragraph 9')).not.toBeInTheDocument();
    expect(screen.getByText('Paragraph 10').closest('.diff-line')).toHaveClass('diff-same');
    expect(screen.getByText(/The title changed/)).toHaveTextContent(
      'The title changed from “Atlas” to “Project Atlas”.',
    );
  });

  it('says so when nothing changed', () => {
    const note = { title: 'Atlas', content: paragraphs.join('\n') };
    const { container } = render(<VersionChanges from={note} to={note} />);
    expect(screen.getByText('The text of this version is the same as the note now.')).toBeInTheDocument();
    expect(screen.queryByText(/The title changed/)).not.toBeInTheDocument();
    expect(container.querySelector('.diff')).toBeNull();
  });

  it('compares the title the way it is saved', () => {
    const content = paragraphs.join('\n');
    const { rerender } = render(<VersionChanges from={{ title: 'Untitled', content }} to={{ title: '', content }} />);
    expect(screen.queryByText(/The title changed/)).not.toBeInTheDocument();

    rerender(<VersionChanges from={{ title: 'Atlas', content }} to={{ title: ' Atlas ', content }} />);
    expect(screen.queryByText(/The title changed/)).not.toBeInTheDocument();

    rerender(<VersionChanges from={{ title: 'Atlas', content }} to={{ title: '  ', content }} />);
    expect(screen.getByText(/The title changed/)).toHaveTextContent('from “Atlas” to “Untitled”.');
  });

  it('falls back to a message when more lines changed than it compares', () => {
    const long = (word: string) => Array.from({ length: 1_100 }, (_, index) => `${word} ${index}`).join('\n');
    const { container } = render(
      <VersionChanges from={{ title: 'Log', content: long('old') }} to={{ title: 'Log', content: long('new') }} />,
    );
    expect(screen.getByText(/More than 2,000 lines differ/)).toBeInTheDocument();
    expect(container.querySelector('.diff')).toBeNull();
  });

  it('stops after a few thousand rows and says how many more lines changed', () => {
    const entries = Array.from({ length: 2_500 }, (_, index) => `Entry ${index + 1}`).join('\n');
    const { container } = render(
      <VersionChanges from={{ title: 'Log', content: `# Log\n${entries}` }} to={{ title: 'Log', content: '# Log' }} />,
    );
    expect(container.querySelectorAll('.diff-line')).toHaveLength(2_000);
    expect(screen.getByText('Entry 1999')).toBeInTheDocument();
    expect(screen.queryByText('Entry 2000')).not.toBeInTheDocument();
    expect(screen.getByText('501 more changed lines are not shown')).toBeInTheDocument();
  });

  it('marks the words that differ inside a changed line, in words for a screen reader too', () => {
    render(
      <VersionChanges
        from={{ title: 'Atlas', content: 'Release at the end of Q2.' }}
        to={{ title: 'Atlas', content: 'Release at the end of Q3.' }}
      />,
    );
    const removed = screen.getByText('Q2').closest('del');
    expect(removed?.closest('.diff-line')).toHaveClass('diff-removed');
    expect(removed).toHaveTextContent('(removed: Q2)');
    expect(screen.getByText('Q3').closest('ins')).toHaveTextContent('(added: Q3)');
    expect(screen.getByText('Q3').closest('.diff-line')).toHaveTextContent(
      '+Added: Release at the end of (added: Q3).',
    );
  });

  it('unfolds a stretch of unchanged lines', async () => {
    const before = [...paragraphs, 'The end'].join('\n');
    render(<VersionChanges from={{ title: 'A', content: before }} to={{ title: 'A', content: `${before}!` }} />);
    expect(screen.queryByText('Paragraph 1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the 9 lines' }));
    expect(screen.getByText('Paragraph 1').closest('.diff-line')).toHaveClass('diff-same');
    expect(screen.queryByText(/unchanged lines/)).not.toBeInTheDocument();
  });

  it('unfolds a long stretch a part at a time', async () => {
    const lines = Array.from({ length: 1_200 }, (_, index) => `Line ${index + 1}`);
    const before = lines.join('\n');
    render(<VersionChanges from={{ title: 'A', content: before }} to={{ title: 'A', content: `${before}\nMore` }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show 500 of them' }));
    expect(screen.getByText('Line 500')).toBeInTheDocument();
    expect(screen.queryByText('Line 501')).not.toBeInTheDocument();
    expect(screen.getByText('697 unchanged lines')).toBeInTheDocument();
  });

  it('names both versions when it compares two of them', () => {
    const { rerender } = render(
      <VersionChanges
        from={{ title: 'A', content: 'one' }}
        to={{ title: 'A', content: 'two' }}
        labels={{ from: '1 March', to: '2 March' }}
      />,
    );
    expect(screen.getByText(/From the version of 1 March to the one of 2 March/)).toBeInTheDocument();
    rerender(
      <VersionChanges
        from={{ title: 'A', content: 'one' }}
        to={{ title: 'A', content: 'one' }}
        labels={{ from: '1 March', to: '2 March' }}
      />,
    );
    expect(screen.getByText('The two versions have the same text.')).toBeInTheDocument();
  });
});
