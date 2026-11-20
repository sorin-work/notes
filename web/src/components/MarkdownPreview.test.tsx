import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { toggleTask } from '../lib/tasks';
import * as wikilinks from '../lib/wikilinks';
import { MarkdownPreview } from './MarkdownPreview';

/** The preview with its text in state and boxes wired to toggleTask, as in the editor. */
function Checklist({ initial, onText }: { initial: string; onText: (text: string) => void }) {
  const [content, setContent] = useState(initial);
  return (
    <MarkdownPreview
      content={content}
      onToggleTask={(line, checked) => {
        const next = toggleTask(content, line, checked);
        setContent(next);
        onText(next);
      }}
    />
  );
}

/** Renders `text`, clicks the box with that name and returns the text afterwards. */
async function clickBox(text: string, name: string): Promise<string> {
  const onText = vi.fn<(text: string) => void>();
  render(<Checklist initial={text} onText={onText} />);
  await userEvent.click(screen.getByRole('checkbox', { name }));
  expect(onText).toHaveBeenCalledTimes(1);
  return onText.mock.calls[0]?.[0] ?? '';
}

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

  it('keeps task boxes read-only without a handler', () => {
    render(<MarkdownPreview content={'- [ ] open\n- [x] done'} />);
    const [open, done] = screen.getAllByRole('checkbox');
    expect(open).toBeDisabled();
    expect(done).toBeDisabled();
    expect(done).toBeChecked();
  });

  it('calls back with the source line when a task box is clicked', async () => {
    const onToggleTask = vi.fn();
    const content = [
      'Left over from [[Project Atlas|the project]]',
      'and [[Weekly review]].',
      '',
      '```',
      '- [ ] not a task',
      '```',
      '',
      '- [ ] Read [[Atlas data model]]',
      '  - [x] Nested task',
      '',
      '1. [ ] Loose item',
      '',
      '2. [ ] Second loose item',
    ].join('\n');
    render(<MarkdownPreview content={content} onToggleTask={onToggleTask} />);

    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
    const nested = screen.getByRole('checkbox', { name: 'Nested task' });
    expect(nested).toBeEnabled();
    expect(nested).toBeChecked();

    await userEvent.click(screen.getByRole('checkbox', { name: 'Read Atlas data model' }));
    await userEvent.click(nested);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Second loose item' }));
    expect(onToggleTask.mock.calls).toEqual([
      [8, false],
      [9, true],
      [13, false],
    ]);
  });

  it.each(['\n', '\r\n', '\r'])('ticks the clicked box in a text with %j line endings', async (eol) => {
    const lines = ['# List', '', '- [ ] one', '- [x] two', '- [ ] three', ''];
    const text = await clickBox(lines.join(eol), 'three');
    expect(text).toBe(lines.join(eol).replace('[ ] three', '[x] three'));
    expect(screen.getByRole('checkbox', { name: 'three' })).toBeChecked();
  });

  it.each(['one', 'three'])('ticks %j below a link with a line break in it', async (name) => {
    const text = 'Notes for [[Project\rAtlas]] this week\r\r- [ ] one\r- [ ] two\r- [ ] three';
    expect(await clickBox(text, name)).toBe(text.replace(`[ ] ${name}`, `[x] ${name}`));
  });

  it('leaves a link definition alone when the box of the item is on the next line', async () => {
    const text = '- [x]: https://example.com/spec\n  [ ] read the spec';
    expect(await clickBox(text, 'read the spec')).toBe(text);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('keeps boxes read-only when the preview and the source differ in their lines', () => {
    vi.spyOn(wikilinks, 'linkifyWikiLinks').mockImplementation((text) => text.replace('\n', ' '));
    render(<MarkdownPreview content={'Intro\n\n- [ ] one'} onToggleTask={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
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
