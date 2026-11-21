/** A piece of a changed line, and whether it is only on that side. */
export interface LinePart {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
  /**
   * For a removed line paired with an added one, or the other way round: the
   * line in pieces, with the words that differ marked. Not set where the line
   * is shown whole.
   */
  parts?: LinePart[];
}

/** A line of a diff, or a run of unchanged lines that was left out, with the lines it hides. */
export type DiffRow = DiffLine | { type: 'skipped'; count: number; lines: DiffLine[] };

/**
 * How many lines may be added plus removed before diffLines gives up. The
 * search remembers every round it took, which is about this number squared
 * in memory (16 MB here).
 */
export const MAX_EDITS = 2_000;

/** How many rows of a diff are shown. Building many more than this makes the page hang. */
export const MAX_ROWS = 2_000;

/**
 * The cut-off for the words of one pair of lines, like MAX_EDITS for lines:
 * past this many words and spaces added plus removed, or past MAX_WORD_SPAN
 * of them between the first and the last that differ, the lines are shown
 * whole. A pasted table or a line of minified code would take too long.
 */
export const MAX_WORD_EDITS = 200;
export const MAX_WORD_SPAN = 2_000;

/**
 * How much work markWords does over a whole diff before it shows the rest of
 * the lines whole: every word and space it reads, and every step of the
 * search, for the pairs it marks and for those it gives up on alike.
 */
export const MAX_WORD_WORK = 1_000_000;

/** What one word or space read counts for against MAX_WORD_WORK, where one step of the search counts 1. */
const READ_COST = 10;

/** A pair of lines longer than this in all, in characters, is shown whole without being read. */
export const MAX_WORD_LINE = 100_000;

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
 * The shortest edits between two lists, with the items that match at the
 * start and at the end set aside first: most edits touch a small part of a
 * text. `span` is how many items that part holds on both sides. `edits` is
 * null past `maxEdits`, and without a search when the span is over `maxSpan`.
 */
function diffItems(
  a: string[],
  b: string[],
  maxEdits: number,
  maxSpan = Infinity,
): { edits: DiffLine[] | null; span: number } {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const span = endA - start + (endB - start);
  if (span > maxSpan) return { edits: null, span };
  const changed = shortestEdits(a.slice(start, endA), b.slice(start, endB), maxEdits);
  if (changed === null) return { edits: null, span };
  return {
    edits: [...a.slice(0, start).map(asLine('same')), ...changed, ...a.slice(endA).map(asLine('same'))],
    span,
  };
}

/**
 * Compares two texts line by line. Lines that are only in `before` come back
 * as removed and lines that are only in `after` as added. Line endings are
 * not compared. Returns null when more than `maxEdits` lines were added and
 * removed between the first and the last line that differ.
 */
export function diffLines(before: string, after: string, maxEdits = MAX_EDITS): DiffLine[] | null {
  return diffItems(splitLines(before), splitLines(after), maxEdits).edits;
}

/** Words, runs of spaces, and every other character on its own. */
const TOKEN = /[\p{L}\p{M}\p{N}_]+|\s+|[^\p{L}\p{M}\p{N}_\s]/gu;

/** Joins neighbouring pieces that are both changed or both not. */
function joinParts(parts: LinePart[]): LinePart[] {
  const joined: LinePart[] = [];
  for (const part of parts) {
    const last = joined.at(-1);
    if (last && last.changed === part.changed) last.text += part.text;
    else joined.push({ ...part });
  }
  return joined;
}

/**
 * A space between two changed words is marked with them, so that "a b c" to
 * "x y c" marks "a b" as one stretch and not as two words.
 */
function bridgeSpaces(parts: LinePart[]): LinePart[] {
  return parts.map((part, index) =>
    !part.changed && /^\s+$/.test(part.text) && parts[index - 1]?.changed && parts[index + 1]?.changed
      ? { ...part, changed: true }
      : part,
  );
}

const solid = (text: string) => text.replace(/\s+/g, '').length;

/**
 * The words that differ between a removed line and the added line it faces.
 * Returns null when the lines should be shown whole: past the cut-offs, or
 * when they have so little in common, under a third of the longer one, that
 * marks would cover nearly everything.
 */
export function diffWords(before: string, after: string): { removed: LinePart[]; added: LinePart[] } | null {
  return compareWords(before, after).words;
}

/**
 * diffWords, with the work it took: nothing for a pair too long to read,
 * else the words and spaces read, READ_COST each, plus the steps of the
 * search, the changed stretch once for each round it ran, which for a search
 * that gave up is every round it had.
 */
function compareWords(
  before: string,
  after: string,
): { words: { removed: LinePart[]; added: LinePart[] } | null; work: number } {
  if (before.length + after.length > MAX_WORD_LINE) return { words: null, work: 0 };
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  const { edits, span } = diffItems(a, b, MAX_WORD_EDITS, MAX_WORD_SPAN);
  // Reading a word costs a match, an allocation and a comparison, far more than one step of the search.
  const read = (a.length + b.length) * READ_COST;
  if (edits === null) {
    return { words: null, work: read + (span > MAX_WORD_SPAN ? 0 : span * Math.min(span, MAX_WORD_EDITS)) };
  }
  const rounds = edits.filter((edit) => edit.type !== 'same').length + 1;
  const work = read + span * rounds;
  const common = edits.filter((edit) => edit.type === 'same').reduce((sum, edit) => sum + solid(edit.text), 0);
  if (common * 3 < Math.max(solid(before), solid(after))) return { words: null, work };
  const side = (type: 'removed' | 'added') =>
    joinParts(
      bridgeSpaces(
        edits
          .filter((edit) => edit.type === 'same' || edit.type === type)
          .map((edit) => ({ text: edit.text, changed: edit.type !== 'same' })),
      ),
    );
  return { words: { removed: side('removed'), added: side('added') }, work };
}

/**
 * Marks the words that differ where a block of removed lines faces a block
 * of added lines: the first removed line with the first added one, and so
 * on. Lines left over when the blocks differ in length, and pairs diffWords
 * shows whole, stay whole. Past MAX_WORD_WORK the rest of the lines are
 * shown whole too.
 */
export function markWords(lines: DiffLine[]): DiffLine[] {
  const marked = lines.map((line) => ({ ...line }));
  let work = 0;
  for (let index = 0; index < marked.length && work < MAX_WORD_WORK;) {
    if (marked[index]?.type !== 'removed') {
      index++;
      continue;
    }
    let removedEnd = index;
    while (marked[removedEnd]?.type === 'removed') removedEnd++;
    let addedEnd = removedEnd;
    while (marked[addedEnd]?.type === 'added') addedEnd++;
    const pairs = Math.min(removedEnd - index, addedEnd - removedEnd);
    for (let pair = 0; pair < pairs && work < MAX_WORD_WORK; pair++) {
      const removed = marked[index + pair];
      const added = marked[removedEnd + pair];
      if (!removed || !added) break;
      const { words, work: spent } = compareWords(removed.text, added.text);
      // Charged whether or not anything is marked: giving up can take as long as succeeding.
      work += spent;
      if (!words) continue;
      removed.parts = words.removed;
      added.parts = words.added;
    }
    index = addedEnd;
  }
  return marked;
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
      const lines = run.slice(head, run.length - tail);
      rows.push(...run.slice(0, head), { type: 'skipped', count: hidden, lines }, ...run.slice(run.length - tail));
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
