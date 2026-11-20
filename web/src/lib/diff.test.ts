import { describe, expect, it } from 'vitest';
import { diffLines, foldUnchanged } from './diff';

/** One character per line: a space for unchanged, - for removed, + for added. */
function signs(before: string, after: string): string | null {
  const lines = diffLines(before, after);
  return lines && lines.map((line) => ({ same: ' ', removed: '-', added: '+' })[line.type]).join('');
}

describe('diffLines', () => {
  it('marks removed and added lines, removed first where a line changed', () => {
    expect(diffLines('one\ntwo\nthree\nfour', 'one\n2\nthree\nfour\nfive')).toEqual([
      { type: 'same', text: 'one' },
      { type: 'removed', text: 'two' },
      { type: 'added', text: '2' },
      { type: 'same', text: 'three' },
      { type: 'same', text: 'four' },
      { type: 'added', text: 'five' },
    ]);
  });

  it('finds a paragraph that was lost between two edits', () => {
    const before = '# Plan\n\nIntro\n\nThe lost paragraph\n\nOutro';
    const after = '# The plan\n\nIntro\n\nOutro\n\nPS';
    expect(signs(before, after)).toBe('-+   -- ++');
  });

  it('handles texts that are equal, empty or share nothing', () => {
    expect(signs('a\nb', 'a\nb')).toBe('  ');
    expect(signs('', '')).toBe('');
    expect(signs('', 'a\nb')).toBe('++');
    expect(signs('a\nb', '')).toBe('--');
    expect(signs('a\nb', 'c\nd')).toBe('--++');
  });

  it('does not compare line endings', () => {
    expect(signs('a\r\nb\r\n', 'a\nb')).toBe('  ');
    expect(signs('a\n', 'a\n\n')).toBe(' +');
  });

  it('compares a long text when only a small part of it changed', () => {
    const lines = Array.from({ length: 20_000 }, (_, index) => `line ${index}`);
    const before = lines.join('\n');
    const after = [...lines.slice(0, 9_000), 'new', ...lines.slice(9_001)].join('\n');
    const changed = diffLines(before, after)?.filter((line) => line.type !== 'same');
    expect(changed).toEqual([
      { type: 'removed', text: 'line 9000' },
      { type: 'added', text: 'new' },
    ]);
  });

  it('gives up when two long texts differ from top to bottom', () => {
    const text = (prefix: string) => Array.from({ length: 3_500 }, (_, index) => `${prefix} ${index}`).join('\n');
    expect(diffLines(text('old'), text('new'))).toBeNull();
  });
});

describe('foldUnchanged', () => {
  const numbered = (count: number) => Array.from({ length: count }, (_, index) => `${index + 1}`);

  it('keeps a few lines around each change and counts the rest', () => {
    const before = numbered(30);
    const after = before.map((line) => (line === '10' ? 'ten' : line === '20' ? 'twenty' : line));
    const rows = foldUnchanged(diffLines(before.join('\n'), after.join('\n')) ?? []);
    expect(rows.map((row) => (row.type === 'skipped' ? `(${row.count})` : row.text))).toEqual([
      '(6)',
      ...['7', '8', '9', '10', 'ten', '11', '12', '13'],
      '(3)',
      ...['17', '18', '19', '20', 'twenty', '21', '22', '23'],
      '(7)',
    ]);
  });

  it('shows short runs in full', () => {
    const rows = foldUnchanged(
      diffLines(numbered(9).join('\n'), ['1', '2', '3', '4', 'five', '6', '7', '8'].join('\n')) ?? [],
    );
    expect(rows.some((row) => row.type === 'skipped')).toBe(false);
    expect(rows).toHaveLength(10);
  });
});
