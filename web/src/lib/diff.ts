export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

/** A line of a diff, or a run of unchanged lines that was left out. */
export type DiffRow = DiffLine | { type: 'skipped'; count: number };

/**
 * Comparing takes a table with one cell for every pair of lines, so two long
 * texts that differ from top to bottom are too much. This is about 3,000
 * lines against 3,000.
 */
const MAX_CELLS = 10_000_000;

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n?|\n/);
  // A line ending at the very end closes the last line, it does not start an empty one.
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Compares two lists of lines through their longest common subsequence. */
function compare(a: string[], b: string[]): DiffLine[] {
  const width = b.length + 1;
  // common[i * width + j] is how many lines a[i..] and b[j..] share, in order.
  // The cell limit keeps both lists far below what a Uint16 can count.
  const common = new Uint16Array((a.length + 1) * width);
  const at = (i: number, j: number) => common[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      common[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const removed = a[i];
    const added = b[j];
    if (removed !== undefined && removed === added) {
      lines.push({ type: 'same', text: removed });
      i++;
      j++;
    } else if (removed !== undefined && (added === undefined || at(i + 1, j) >= at(i, j + 1))) {
      lines.push({ type: 'removed', text: removed });
      i++;
    } else if (added !== undefined) {
      lines.push({ type: 'added', text: added });
      j++;
    }
  }
  return lines;
}

/**
 * Compares two texts line by line. Lines that are only in `before` come back
 * as removed and lines that are only in `after` as added, removed ones first
 * where a line changed. Line endings are not compared. Returns null when the
 * part that differs is too long to compare.
 */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = splitLines(before);
  const b = splitLines(after);

  // Most edits touch a small part of a note. The lines that match at the
  // start and at the end are set aside, and only what lies between is compared.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if ((endA - start) * (endB - start) > MAX_CELLS) return null;

  const same = (text: string): DiffLine => ({ type: 'same', text });
  return [
    ...a.slice(0, start).map(same),
    ...compare(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(same),
  ];
}

/**
 * Leaves out long runs of unchanged lines the way a patch does, keeping
 * `context` lines on each side of a change.
 */
export function foldUnchanged(lines: DiffLine[], context = 3): DiffRow[] {
  const rows: DiffRow[] = [];
  let run: DiffLine[] = [];
  // Called with the unchanged lines between two changes, before the first change or after the last one.
  const endRun = (last: boolean) => {
    const head = rows.length === 0 ? 0 : context;
    const tail = last ? 0 : context;
    const hidden = run.length - head - tail;
    if (hidden > 1) {
      rows.push(...run.slice(0, head), { type: 'skipped', count: hidden }, ...run.slice(run.length - tail));
    } else {
      rows.push(...run);
    }
    run = [];
  };
  for (const line of lines) {
    if (line.type === 'same') {
      run.push(line);
    } else {
      endRun(false);
      rows.push(line);
    }
  }
  endRun(true);
  return rows;
}
