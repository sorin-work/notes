import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownPreview } from './MarkdownPreview';

describe('MarkdownPreview', () => {
  it('renders Markdown with GitHub extensions', () => {
    render(<MarkdownPreview content={'# Plan\n\n- [x] done\n\n| a | b |\n| - | - |\n| 1 | 2 |'} />);
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('calls back with the title when a wiki link is clicked', async () => {
    const onWikiLink = vi.fn();
    render(<MarkdownPreview content="See [[Project Atlas|the project]]" onWikiLink={onWikiLink} />);
    await userEvent.click(screen.getByRole('link', { name: 'the project' }));
    expect(onWikiLink).toHaveBeenCalledWith('Project Atlas');
  });

  it('marks links to notes that do not exist', () => {
    render(
      <MarkdownPreview content="[[Here]] and [[Missing]]" onWikiLink={vi.fn()} missingTitles={new Set(['missing'])} />,
    );
    expect(screen.getByRole('link', { name: 'Missing' })).toHaveClass('wikilink-missing');
    expect(screen.getByRole('link', { name: 'Here' })).not.toHaveClass('wikilink-missing');
  });

  it('renders wiki links as text without a handler, e.g. on shared pages', () => {
    render(<MarkdownPreview content="See [[Private note]]" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('Private note')).toHaveClass('wikilink-static');
  });

  it('opens normal links in a new tab and drops javascript: URLs', () => {
    render(<MarkdownPreview content="[docs](https://example.com) [bad](javascript:alert(1))" />);
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('target', '_blank');
    expect(screen.getByText('bad').getAttribute('href') ?? '').not.toContain('javascript');
  });

  it('does not render raw HTML', () => {
    const { container } = render(<MarkdownPreview content={'<img src=x onerror="alert(1)">'} />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows a hint for empty notes', () => {
    render(<MarkdownPreview content="   " />);
    expect(screen.getByText('Nothing to preview yet.')).toBeInTheDocument();
  });
});
