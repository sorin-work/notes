import type { Nodes } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

/** A stretch of a note, as positions in its text. */
export interface Span {
  from: number;
  to: number;
}

/** What the parser makes of a note: where its plain text is, and what must never change. */
export interface ParsedNote {
  prose: Span[];
  verbatim: string[];
  /** Emphasis, strong and strikethrough, as "type:from:to", in order. A link must not change how these pair up. */
  formatting: string[];
  /** The labels of reference definitions and footnotes, normalised: brackets around such a label make a reference, not a [[link]]. */
  labels: string[];
}

/**
 * Nodes whose source has to come out of any change to a note exactly as it
 * went in, and inside which nothing is plain text: code, HTML, links and
 * images with everything in their labels, references and definitions.
 */
const VERBATIM = new Set([
  'inlineCode',
  'code',
  'html',
  'link',
  'linkReference',
  'image',
  'imageReference',
  'definition',
  'footnoteReference',
]);

/** Marks whose pairing a pair of brackets next to them can change. */
const FORMATTING = new Set(['emphasis', 'strong', 'delete']);

/** A backslash escape or a character reference: what is written there is not what is shown. */
const ESCAPED = /\\[!-/:-@[-`{-~]|&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{0,31});/g;
const LINE_BREAK = /\r\n|\r|\n/g;
/** What stands at the start of a line that goes on a paragraph: indentation and the marks of quotes. */
const CONTINUATION = /^[ \t>]*/;

/**
 * The parser is not quick: a long note of short lines or a long list takes
 * it about a second for every 100,000 characters, and some input takes it
 * time that grows with the square of the length: many closing brackets
 * (each one looks back over the note for a footnote), and quotes or lists
 * nested very deep, which can also run it out of stack. Notes like that are
 * not parsed at all. Real notes stay far below these limits.
 */
export const MAX_PARSED_NOTE_LENGTH = 100_000;
const MAX_CLOSING_BRACKETS = 2_000;
const MAX_NESTING = 16;
// A quote mark needs no space after it to open a quote, a list marker does.
const TOO_DEEP = new RegExp(`^(?:[ \\t]*(?:>[ \\t]*|(?:[-+*]|\\d{1,9}[.)])(?:[ \\t]+|$))){${MAX_NESTING + 1}}`, 'm');

/** Whether the parser can be given this note: see MAX_PARSED_NOTE_LENGTH. */
export function parseable(text: string): boolean {
  if (text.length > MAX_PARSED_NOTE_LENGTH) return false;
  let brackets = 0;
  for (let at = text.indexOf(']'); at !== -1; at = text.indexOf(']', at + 1)) {
    if (++brackets > MAX_CLOSING_BRACKETS) return false;
  }
  return !TOO_DEEP.test(text);
}

/**
 * Reads a note with the parser the web app renders it with (micromark with
 * GFM, the parser of react-markdown and remark-gfm), so what counts as
 * plain text here is what shows as plain text there.
 *
 * The plain text is the text of sentences, headings and table cells, and
 * nothing else. Code of every kind, HTML, links, images and references with
 * all that is inside them, URLs, escapes and character references are left
 * out. A stretch never crosses a line ending (\n, \r\n or a lone \r, which
 * the parser takes for one too) and never holds the marks at the start of a
 * line inside a quote or a list.
 *
 * Returns null when the parser gives no position for some node, or positions
 * that are out of order: then nothing about the note can be trusted. Also
 * for a note the parser would take too long on or fail on.
 */
export function parseNote(text: string): ParsedNote | null {
  if (!parseable(text)) return null;
  let tree: Nodes;
  try {
    tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  } catch {
    return null;
  }
  const prose: Span[] = [];
  const verbatim: string[] = [];
  const formatting: string[] = [];
  const labels: string[] = [];

  // The walk keeps its own stack, because a note can nest quotes thousands deep.
  const stack: Nodes[] = [tree];
  while (stack.length) {
    const node = stack.pop()!;
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined || from > to || to > text.length) return null;

    if ((node.type === 'definition' || node.type === 'footnoteDefinition') && node.label) {
      labels.push(node.label.trim().replace(/\s+/g, ' ').toLowerCase());
    }
    if (FORMATTING.has(node.type)) formatting.push(`${node.type}:${from}:${to}`);
    if (VERBATIM.has(node.type)) {
      verbatim.push(`${node.type}:${text.slice(from, to)}`);
    } else if (node.type === 'text') {
      addText(text, from, to, prose);
    } else if (node.type === 'table') {
      // Cells beyond the number of the header's are not shown, so nothing in them counts.
      const columns = node.children[0]?.children.length ?? 0;
      for (let index = node.children.length - 1; index >= 0; index--) {
        const row = node.children[index];
        stack.push({ ...row, children: row.children.slice(0, columns) });
      }
    } else if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
    }
  }
  return inOrder(prose) ? { prose, verbatim, formatting, labels } : null;
}

/** Adds the source of one text node, cut at line endings and around escapes. */
function addText(text: string, from: number, to: number, prose: Span[]) {
  const source = text.slice(from, to);
  let lineStart = 0;
  const lines: Span[] = [];
  for (const end of source.matchAll(LINE_BREAK)) {
    lines.push({ from: lineStart, to: end.index });
    lineStart = end.index + end[0].length;
  }
  lines.push({ from: lineStart, to: source.length });

  lines.forEach((line, index) => {
    let start = line.from;
    if (index > 0) start += CONTINUATION.exec(source.slice(line.from, line.to))![0].length;
    const piece = source.slice(start, line.to);
    let at = 0;
    for (const escaped of piece.matchAll(ESCAPED)) {
      if (escaped.index > at) prose.push({ from: from + start + at, to: from + start + escaped.index });
      at = escaped.index + escaped[0].length;
    }
    if (piece.length > at) prose.push({ from: from + start + at, to: from + line.to });
  });
}

/** In order and not overlapping. */
function inOrder(spans: Span[]): boolean {
  let last = 0;
  for (const { from, to } of spans) {
    if (!(from >= last && to > from)) return false;
    last = to;
  }
  return true;
}

/** The plain text of a note, as parseNote finds it. Empty when its positions cannot be trusted. */
export function proseSpans(text: string): Span[] {
  return parseNote(text)?.prose ?? [];
}

/**
 * Every code span, code block, piece of HTML, link, image, reference and
 * definition in a note, each with its kind and exactly as written, in
 * order. Two notes that only differ in their plain text give the same list.
 */
export function verbatimParts(text: string): string[] {
  return parseNote(text)?.verbatim ?? [];
}

/** A task list item of a note: the line it starts on (counted from 1), its words, and whether it is ticked. */
export interface TaskItem {
  line: number;
  text: string;
  done: boolean;
}

/** How much of the words of a task is kept. The rest of a long one is cut off with "…". */
export const MAX_TASK_TEXT = 300;

/** The words of a task item as the preview shows them, without the lists nested in it. */
function taskText(item: Nodes): string {
  const parts: string[] = [];
  const stack: Nodes[] = [item];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'text' || node.type === 'inlineCode') parts.push(node.value);
    else if (node.type === 'image') parts.push(node.alt ?? '');
    else if (node.type === 'break') parts.push(' ');
    else if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index];
        // A nested list holds tasks of its own, and a paragraph after the first one starts on a line of its own.
        if (child.type !== 'list') stack.push(child);
      }
      if (node.type === 'paragraph') parts.push(' ');
    }
  }
  const text = parts.join('').replace(/\s+/g, ' ').trim();
  return text.length > MAX_TASK_TEXT ? `${text.slice(0, MAX_TASK_TEXT - 1)}…` : text;
}

/**
 * The task list items of a note, ticked or not, in order, read with the
 * same parser and limits as parseNote: a `- [ ]` in code is no task. Null for
 * a note the parser would take too long on or fails on.
 */
export function parseTasks(text: string): TaskItem[] | null {
  if (!parseable(text)) return null;
  let tree: Nodes;
  try {
    tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  } catch {
    return null;
  }
  const tasks: TaskItem[] = [];
  const stack: Nodes[] = [tree];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.type === 'listItem' && typeof node.checked === 'boolean') {
      const line = node.position?.start.line;
      if (line === undefined) return null;
      tasks.push({ line, text: taskText(node), done: node.checked });
    }
    if ('children' in node) {
      for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
    }
  }
  return tasks;
}
