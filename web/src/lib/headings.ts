import type { Heading, Nodes, Root } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { linkifyWikiLinks } from './wikilinks';

/**
 * In front of every heading id, so that a heading called "Main" or "Note"
 * cannot take the id of the app's own landmarks, which the skip link targets.
 */
export const HEADING_ID_PREFIX = 'h-';

/** A heading of a note, in the order the preview shows them. */
export interface NoteHeading {
  /** 1 for `#`, up to 6. */
  depth: number;
  /** The words of the heading as the preview shows them, without Markdown. */
  text: string;
  /** The line of the source it starts on, counted from 1. */
  line: number;
  /** The slug, unique within the note. The element id is this with the prefix. */
  slug: string;
}

/**
 * The slug GitHub makes from the text of a heading: lower case, everything
 * but letters, digits, marks, `_`, `-` and spaces dropped, then each space a
 * `-`. Links to a heading are matched with this too, so `[[Note#Next steps]]`
 * and `[[Note#next-steps]]` both lead to "Next steps".
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Hands out slugs, giving a repeated one `-1`, `-2` and on, as GitHub does. */
export function createSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    let slug = base;
    while (seen.has(slug)) {
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      slug = `${base}-${count}`;
    }
    seen.set(slug, 0);
    return slug;
  };
}

export const headingId = (slug: string): string => HEADING_ID_PREFIX + slug;

/** The slug in an address like `#h-next-steps`, or null when it is not one of a heading. */
export function slugFromHash(hash: string): string | null {
  if (!hash.startsWith(`#${HEADING_ID_PREFIX}`)) return null;
  try {
    return decodeURIComponent(hash.slice(1 + HEADING_ID_PREFIX.length));
  } catch {
    return null;
  }
}

/** Calls `fn` on every heading of a tree, in document order, inside quotes and lists as well. */
function eachHeading(tree: Root, fn: (heading: Heading) => void): void {
  const walk = (node: Nodes) => {
    if (node.type === 'heading') fn(node);
    if ('children' in node) for (const child of node.children) walk(child);
  };
  walk(tree);
}

/**
 * A remark plugin for the preview: gives each heading its id, and puts the
 * slugs it handed out into `slugs` so the preview can tell links to a heading
 * that is not there.
 */
export function remarkHeadingIds(options: { slugs: Set<string> }) {
  return (tree: Root) => {
    const slug = createSlugger();
    eachHeading(tree, (heading) => {
      const id = slug(toString(heading));
      options.slugs.add(id);
      heading.data = {
        ...heading.data,
        hProperties: { ...heading.data?.hProperties, id: headingId(id), tabIndex: -1 },
      };
    });
  };
}

const parser = unified().use(remarkParse).use(remarkGfm);

/**
 * The headings of a note, read the way the preview reads them: the same
 * parser over the same linkified text, so a `#` line in code is no heading
 * and an underlined (Setext) one is, and each gets the slug its id has.
 */
export function noteHeadings(markdown: string): NoteHeading[] {
  // A heading needs a # or the = or - that underline one.
  if (!/[#=-]/.test(markdown)) return [];
  // Nothing runs on the tree, so it is the tree the parser made.
  const tree = parser.parse(linkifyWikiLinks(markdown));
  const slug = createSlugger();
  const headings: NoteHeading[] = [];
  eachHeading(tree, (heading) => {
    const text = toString(heading);
    headings.push({ depth: heading.depth, text, line: heading.position?.start.line ?? 1, slug: slug(text) });
  });
  return headings;
}

/** The heading a link's `#part` leads to: the first whose slug is the slug of what the link says. */
export function findHeading(headings: NoteHeading[], wanted: string): NoteHeading | undefined {
  const slug = slugify(wanted.trim());
  return headings.find((heading) => heading.slug === slug);
}

/**
 * What to write after the `#` of a link to `heading`: its words where they
 * can stand in a link and lead back to it, else its slug, which is the only
 * way to reach the second of two headings with the same words.
 */
export function headingLinkText(heading: NoteHeading, headings: NoteHeading[]): string {
  const text = heading.text.trim().replace(/\s+/g, ' ');
  if (text && !/[[\]|\r\n]/.test(text) && findHeading(headings, text) === heading) return text;
  return heading.slug;
}

/** Where line `line` (counted from 1) starts in the text, with the parser's line endings. */
export function lineOffset(text: string, line: number): number {
  const ending = /\r\n?|\n/g;
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const match = ending.exec(text);
    if (!match) return text.length;
    offset = match.index + match[0].length;
  }
  return offset;
}
