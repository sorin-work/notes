/**
 * Kept in step with web/src/lib/mask.ts, which is the same code: the API
 * stores and rewrites the [[links]] that the preview shows, so both have to
 * agree on where links cannot be.
 *
 * The text of a note with every piece of code and math blanked out: the
 * same length, the same line endings, spaces in their place. A [[link]] is
 * looked for in what is left, so its positions are positions in the note.
 *
 * It follows the rules of the parser (micromark with GFM, and math between
 * `$$` only, as the preview reads it) for what it blanks:
 *
 * - a fenced code block, from a line of three or more ` or ~ to a line of
 *   at least as many of the same, or to the end;
 * - a block of math, from a line that starts with two or more `$` and has no
 *   other `$` to a line of at least as many `$` and nothing but spaces, or
 *   to the end;
 * - inside a paragraph, which ends at a blank line or a fence and can run
 *   over several lines: a code span between two runs of backticks of the
 *   same length, and math between two runs of two or more `$` of the same
 *   length. A backslash before a `$` escapes it.
 *
 * It is a scan, not the parser: the parser can take seconds on a note built
 * to trip it, and this runs on every save. Each character is looked at a
 * fixed number of times. Quotes, lists and HTML are not told apart: a fence
 * or a paragraph inside a quote is taken as if it stood on its own.
 */

const LINE_END = /\r\n|\r|\n/g;
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const MATH_OPEN = /^ {0,3}(\${2,})[^$]*$/;

interface Line {
  start: number;
  /** Where the line ends, before its line ending. */
  end: number;
}

function linesOf(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const match of text.matchAll(LINE_END)) {
    lines.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  lines.push({ start, end: text.length });
  return lines;
}

/**
 * Runs of backticks and of `$` in a stretch of text: where each starts, and
 * how long it is. A `$` after a backslash is escaped and in no run. A
 * backslash before a backtick is left alone, as the code finder always did:
 * inside a code span it escapes nothing.
 */
function runsOf(text: string, from: number, to: number) {
  const runs: { at: number; length: number; char: string }[] = [];
  for (let at = from; at < to;) {
    const char = text[at];
    if (char === '\\' && text[at + 1] === '$') {
      at += 2;
      continue;
    }
    if (char !== '`' && char !== '$') {
      at++;
      continue;
    }
    let end = at + 1;
    while (end < to && text[end] === char) end++;
    runs.push({ at, length: end - at, char });
    at = end;
  }
  return runs;
}

/**
 * The code spans and math in a paragraph, from `from` to `to`. A run opens
 * a span when a later run of the same character and length closes it. The
 * runs that could close are kept by character and length, each list walked
 * once from the front, so a paragraph full of unclosed runs takes no longer
 * than one with none.
 */
function inlineSpans(text: string, from: number, to: number, blank: (from: number, to: number) => void): void {
  const runs = runsOf(text, from, to);
  const byKind = new Map<string, number[]>();
  runs.forEach((run, index) => {
    const key = `${run.char}${run.length}`;
    const list = byKind.get(key);
    if (list) list.push(index);
    else byKind.set(key, [index]);
  });
  const next = new Map<string, number>();
  for (let index = 0; index < runs.length;) {
    const run = runs[index];
    // Math needs two `$` or more: a single one is a dollar.
    if (!run || (run.char === '$' && run.length < 2)) {
      index++;
      continue;
    }
    const key = `${run.char}${run.length}`;
    const list = byKind.get(key) ?? [];
    let pointer = next.get(key) ?? 0;
    while (pointer < list.length && (list[pointer] ?? Infinity) <= index) pointer++;
    next.set(key, pointer);
    const closing = list[pointer];
    const close = closing === undefined ? undefined : runs[closing];
    if (closing === undefined || !close) {
      index++;
      continue;
    }
    blank(run.at, close.at + close.length);
    index = closing + 1;
  }
}

export function maskNonProse(text: string): string {
  const ranges: [number, number][] = [];
  const blank = (from: number, to: number) => {
    if (to > from) ranges.push([from, to]);
  };
  const lines = linesOf(text);
  let paragraph: { from: number; to: number } | null = null;
  const endParagraph = () => {
    if (paragraph) inlineSpans(text, paragraph.from, paragraph.to, blank);
    paragraph = null;
  };

  let codeFence: string | null = null;
  let mathFence = 0;
  for (const line of lines) {
    const content = text.slice(line.start, line.end);
    if (codeFence !== null) {
      blank(line.start, line.end);
      // Closed by a run of the same character, at least as long, with nothing but spaces after it.
      const close = CODE_FENCE.exec(content);
      const run = close?.[1] ?? '';
      if (
        close &&
        run[0] === codeFence[0] &&
        run.length >= codeFence.length &&
        /^[ \t]*$/.test(content.slice(close[0].length))
      ) {
        codeFence = null;
      }
      continue;
    }
    if (mathFence > 0) {
      blank(line.start, line.end);
      // Closed by a line of at least as many `$` as opened it, and nothing else.
      const close = /^ {0,3}(\$+)[ \t]*$/.exec(content);
      if (close && (close[1] ?? '').length >= mathFence) mathFence = 0;
      continue;
    }
    const code = CODE_FENCE.exec(content);
    const fence = code?.[1] ?? '';
    // A backtick fence cannot have a backtick in its info string.
    if (code && !(fence[0] === '`' && content.slice(code[0].length).includes('`'))) {
      endParagraph();
      codeFence = fence;
      blank(line.start, line.end);
      continue;
    }
    const math = MATH_OPEN.exec(content);
    if (math) {
      endParagraph();
      mathFence = (math[1] ?? '').length;
      blank(line.start, line.end);
      continue;
    }
    if (content.trim() === '') {
      endParagraph();
      continue;
    }
    if (paragraph) paragraph.to = line.end;
    else paragraph = { from: line.start, to: line.end };
  }
  endParagraph();

  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  let result = '';
  let copied = 0;
  for (const [from, to] of ranges) {
    if (to <= copied) continue;
    const start = Math.max(from, copied);
    result += text.slice(copied, start) + text.slice(start, to).replace(/[^\r\n]/g, ' ');
    copied = to;
  }
  return result + text.slice(copied);
}
