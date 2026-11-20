import { describe, expect, it } from 'vitest';
import { capRows, type DiffLine, diffLines, foldUnchanged, MAX_EDITS } from './diff';

/** One character per line: a space for unchanged, - for removed, + for added. */
function signs(before: string, after: string): string | null {
  const lines = diffLines(before, after);
  return lines && lines.map((line) => ({ same: ' ', removed: '-', added: '+' })[line.type]).join('');
}

const changed = (lines: DiffLine[] | null) => lines?.filter((line) => line.type !== 'same');

/**
 * How many lines have to be added and removed at the least, from a table of
 * the longest common subsequence of every pair of endings. Slow and simple,
 * and what this module used at first.
 */
function fewestEdits(a: string[], b: string[]): number {
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  const at = (i: number, j: number) => common[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      (common[i] ?? [])[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return a.length + b.length - 2 * at(0, 0);
}

/** Repeatable random numbers from 0 up to, not including, 1. */
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

  it('turns one text into the other with as few edits as a full table finds', () => {
    const random = seeded(20261120);
    const below = (limit: number) => Math.floor(random() * limit);
    for (let round = 0; round < 400; round++) {
      // Few different lines make for many repeats, which is where diffs go wrong.
      const kinds = 1 + below(6);
      const text = () => Array.from({ length: below(45) }, () => `line ${below(kinds)}`);
      const a = text();
      const b = text();
      const lines = diffLines(a.join('\n'), b.join('\n'));
      expect(lines?.filter((line) => line.type !== 'added').map((line) => line.text)).toEqual(a);
      expect(lines?.filter((line) => line.type !== 'removed').map((line) => line.text)).toEqual(b);
      expect(changed(lines)).toHaveLength(fewestEdits(a, b));
    }
  });

  it('compares a long text whose first and last lines changed', () => {
    const lines = Array.from({ length: 50_000 }, (_, index) => `line ${index}`);
    const after = ['new start', ...lines.slice(1, 25_000), 'new middle', ...lines.slice(25_001, -1), 'new end'];
    expect(changed(diffLines(lines.join('\n'), after.join('\n')))).toEqual([
      { type: 'removed', text: 'line 0' },
      { type: 'added', text: 'new start' },
      { type: 'removed', text: 'line 25000' },
      { type: 'added', text: 'new middle' },
      { type: 'removed', text: 'line 49999' },
      { type: 'added', text: 'new end' },
    ]);
  });

  it('compares a block that was only added or only removed, whatever its size', () => {
    const log = Array.from({ length: 100_000 }, (_, index) => `entry ${index}`).join('\n');
    expect(changed(diffLines('# Log\n\nEnd', `# Log\n${log}\n\nEnd`))).toHaveLength(100_000);
    expect(changed(diffLines(`# Log\n${log}`, '# Log'))).toHaveLength(100_000);
  });

  it('gives up when more lines changed than the limit', () => {
    const text = (word: string, count: number) => Array.from({ length: count }, (_, i) => `${word} ${i}`).join('\n');
    expect(changed(diffLines(text('old', MAX_EDITS / 2), text('new', MAX_EDITS / 2)))).toHaveLength(MAX_EDITS);
    expect(diffLines(text('old', MAX_EDITS / 2 + 1), text('new', MAX_EDITS / 2))).toBeNull();
    expect(signs('a\nb\nc', 'c\nd')).toBe('-- +');
    expect(diffLines('a\nb\nc', 'c\nd', 2)).toBeNull();
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

describe('capRows', () => {
  const rows = foldUnchanged(diffLines('a\nb\nc\nd\ne\nf', 'a\nB\nc\nd\nE\nf') ?? []);

  it('cuts a long diff and counts the changed lines it left out', () => {
    expect(rows).toHaveLength(8);
    expect(capRows(rows, 4)).toEqual({ rows: rows.slice(0, 4), more: 2 });
    expect(capRows(rows, 2).more).toBe(3);
  });

  it('keeps everything when the rest holds no change', () => {
    expect(capRows(rows, 7)).toEqual({ rows, more: 0 });
    expect(capRows(rows, 100)).toEqual({ rows, more: 0 });
  });
});
