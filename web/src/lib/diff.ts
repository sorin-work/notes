export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

/** A line of a diff, or a run of unchanged lines that was left out. */
export type DiffRow = DiffLine | { type: 'skipped'; count: number };

/**
 * How many lines may be added plus removed before diffLines gives up. The
 * search remembers every round it took, which is about this number squared
 * in memory (16 MB here).
 */
export const MAX_EDITS = 2_000;

/** How many rows of a diff are shown. Building many more than this makes the page hang. */
export const MAX_ROWS = 2_000;

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n?|\n/);
  // A line ending at the very end closes the last line, it does not start an empty one.
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

const asLine =
  (type: DiffLine['type']) =>
  (text: string): DiffLine => ({ type, text });

const at = (values: Int32Array, index: number) => values[index] ?? 0;

/**
 * Myers' algorithm keeps, for each diagonal k (the points x lines into the
 * old text and y lines into the new one with x - y = k), the largest x a
 * path has reached. `zero` is where diagonal 0 sits in `reach`. In round d a
 * path gets onto diagonal k either by adding a line, coming from k + 1, or by
 * removing one, coming from k - 1. This says which, and takes the one that
 * is further along.
 */
function addsLine(reach: Int32Array, zero: number, k: number, d: number): boolean {
  return k === -d || (k !== d && at(reach, zero + k - 1) < at(reach, zero + k + 1));
}

/**
 * The shortest way to turn `a` into `b` by removing and adding lines. The
 * search tries zero edits, then one, then two and so on, so the work grows
 * with how much changed and not with the length of the texts. Returns null
 * when more than `maxEdits` are needed.
 */
function shortestEdits(a: string[], b: string[], maxEdits: number): DiffLine[] | null {
  // A block that was only added or only removed needs no search, whatever its size.
  if (a.length === 0 || b.length === 0) return [...a.map(asLine('removed')), ...b.map(asLine('added'))];

  const limit = Math.min(a.length + b.length, maxEdits);
  const zero = limit + 1;
  const reach = new Int32Array(2 * limit + 3);
  // rounds[d] is `reach` as round d found it, cut down to the diagonals -d-1..d+1 that the round reads.
  const rounds: Int32Array[] = [];
  for (let d = 0; d <= limit; d++) {
    rounds.push(reach.slice(zero - d - 1, zero + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = addsLine(reach, zero, k, d) ? at(reach, zero + k + 1) : at(reach, zero + k - 1) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) {
        x++;
        y++;
      }
      reach[zero + k] = x;
      if (x >= a.length && y >= b.length) return walkBack(a, b, rounds);
    }
  }
  return null;
}

/** Reads the edits off the rounds of a finished search, from the end of both texts back to the start. */
function walkBack(a: string[], b: string[], rounds: Int32Array[]): DiffLine[] {
  const lines: DiffLine[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = rounds.length - 1; d >= 0; d--) {
    const reach = rounds[d] ?? new Int32Array(0);
    const zero = d + 1;
    const k = x - y;
    const added = addsLine(reach, zero, k, d);
    const fromK = added ? k + 1 : k - 1;
    const fromX = at(reach, zero + fromK);
    const fromY = fromX - fromK;
    // First the equal lines the round ran along, then the one line it added or removed.
    while (x > fromX && y > fromY) {
      x--;
      y--;
      lines.push({ type: 'same', text: a[x] ?? '' });
    }
    if (d > 0 && added) lines.push({ type: 'added', text: b[--y] ?? '' });
    if (d > 0 && !added) lines.push({ type: 'removed', text: a[--x] ?? '' });
  }
  return lines.reverse();
}

/**
 * Compares two texts line by line. Lines that are only in `before` come back
 * as removed and lines that are only in `after` as added. Line endings are
 * not compared. Returns null when more than `maxEdits` lines were added and
 * removed between the first and the last line that differ.
 */
export function diffLines(before: string, after: string, maxEdits = MAX_EDITS): DiffLine[] | null {
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
  const changed = shortestEdits(a.slice(start, endA), b.slice(start, endB), maxEdits);
  if (changed === null) return null;
  return [...a.slice(0, start).map(asLine('same')), ...changed, ...a.slice(endA).map(asLine('same'))];
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

/**
 * Cuts a long diff off after `max` rows. `more` is how many added and removed
 * lines were cut. A tail without any is kept, it is only a few rows.
 */
export function capRows(rows: DiffRow[], max = MAX_ROWS): { rows: DiffRow[]; more: number } {
  let more = 0;
  for (let index = max; index < rows.length; index++) {
    const type = rows[index]?.type;
    if (type === 'added' || type === 'removed') more++;
  }
  return more === 0 ? { rows, more } : { rows: rows.slice(0, max), more };
}
