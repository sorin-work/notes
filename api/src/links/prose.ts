import { GFM, parser } from '@lezer/markdown';

/** A stretch of a note, as positions in its text. */
export interface Span {
  from: number;
  to: number;
}

const markdown = parser.configure([GFM]);

/** Blocks and inline wrappers whose own text is prose, apart from what their children cover. */
const PROSE = new Set([
  'Paragraph',
  'ATXHeading1',
  'ATXHeading2',
  'ATXHeading3',
  'ATXHeading4',
  'ATXHeading5',
  'ATXHeading6',
  'SetextHeading1',
  'SetextHeading2',
  'TableCell',
  'Task',
  'Emphasis',
  'StrongEmphasis',
  'Strikethrough',
]);

/** What must come out of any change to a note exactly as it went in. */
const VERBATIM = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'URL', 'HTMLBlock', 'HTMLTag']);

/**
 * The plain text of a note: the stretches that are words of a sentence, a
 * heading or a table cell, and nothing else. Code of every kind is left out
 * (inline, fenced, indented, also inside quotes and lists), and so are the
 * text and the target of links and images, reference definitions, autolinks,
 * bare URLs, HTML, escapes and the marks of Markdown itself. A real parser
 * decides, and gives the positions: guessing them with patterns goes wrong
 * on a URL with brackets in it or a fence inside a quote.
 *
 * A stretch never crosses a line break or any of the things left out.
 */
export function proseSpans(text: string): Span[] {
  const spans: Span[] = [];
  const add = (from: number, to: number) => {
    // One stretch per line, so nothing that is found in one can reach into the next.
    for (let start = from; start < to;) {
      const lineEnd = text.indexOf('\n', start);
      const end = lineEnd === -1 || lineEnd > to ? to : lineEnd;
      if (end > start) spans.push({ from: start, to: end });
      start = end + 1;
    }
  };

  // Everything is walked, since prose sits inside lists, quotes and tables,
  // and only prose is collected: for a node that holds prose, the text
  // before, between and after its children. The walk keeps its own stack,
  // because a note can nest quotes thousands deep and a function calling
  // itself would not survive that.
  const open: { prose: boolean; at: number }[] = [];
  markdown.parse(text).iterate({
    enter(node) {
      const parent = open[open.length - 1];
      if (parent?.prose) add(parent.at, node.from);
      open.push({ prose: PROSE.has(node.name), at: node.from });
    },
    leave(node) {
      const closed = open.pop();
      if (closed?.prose) add(closed.at, node.to);
      const parent = open[open.length - 1];
      if (parent) parent.at = node.to;
    },
  });

  return wellFormed(spans, text.length) ? spans : [];
}

/**
 * The text of every code span, code block, URL and piece of HTML in a note,
 * in order. Two notes that only differ in their prose give the same list.
 */
export function verbatimParts(text: string): string[] {
  const parts: string[] = [];
  markdown.parse(text).iterate({
    enter(node) {
      if (!VERBATIM.has(node.name)) return undefined;
      parts.push(text.slice(node.from, node.to));
      // What is inside belongs to it, and is not listed again.
      return false;
    },
  });
  return parts;
}

/** In order, inside the text and not overlapping. Anything else means the positions cannot be trusted. */
function wellFormed(spans: Span[], length: number): boolean {
  let last = 0;
  for (const { from, to } of spans) {
    if (!(from >= last && to > from && to <= length)) return false;
    last = to;
  }
  return true;
}
