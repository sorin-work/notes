import { maskNonProse } from './mask';

/**
 * Kept in step with api/src/links/wikilinks.ts, with one difference: here the
 * title may be left out, as in [[#Heading]], a link to a heading of the same
 * note. The API reads no link there, since it leads to no other note.
 */
const LINK = /\[\[([^[\]\n|#]*)(?:#([^[\]\n|]*))?(?:\|([^[\]\n]+))?\]\]/g;

export const WIKI_PROTOCOL = 'wiki:';

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

function countCarriageReturns(text: string): number {
  return text.split('\r').length - 1;
}

const collapse = (text: string) => text.trim().replace(/\s+/g, ' ');

/**
 * Rewrites [[Title]], [[Title|text]], [[Title#Heading]] and [[#Heading]] as
 * Markdown links with a wiki: URL so the preview can render them as in-app
 * links. Code and math are left alone.
 *
 * The result has the same line endings as the input, in the same number: the
 * preview finds a clicked task box in the source by its line number. A link
 * cannot hold a \n, but it can hold a lone \r, which the Markdown parser
 * also takes for a line ending.
 */
export function linkifyWikiLinks(markdown: string): string {
  // Code and math are blanked out, keeping every position, so a link found
  // in what is left stands at the same place in the note (see maskNonProse).
  const masked = maskNonProse(markdown);
  let result = '';
  let copied = 0;
  for (const found of masked.matchAll(LINK)) {
    const from = found.index;
    const match = markdown.slice(from, from + found[0].length);
    // Code or math between the brackets: the words there are not a title.
    if (match !== found[0]) continue;
    const [, title = '', heading, alias] = found;
    const target = collapse(title);
    const part = heading === undefined ? '' : collapse(heading);
    // [[]], [[|text]] and [[#]] lead nowhere.
    if (!target && !part) continue;
    const shown = target && part ? `${target} › ${part}` : target || part;
    const label = (alias === undefined ? shown : alias.trim()).replace(/[[\]]/g, '\\$&');
    const url = `${WIKI_PROTOCOL}${encodeURIComponent(target)}${part ? `#${encodeURIComponent(part)}` : ''}`;
    const link = `[${label}](${url})`;
    // Trimming and collapsing spaces lose any \r that was in the link. They
    // go back in front of the link, not after it, where one could join a
    // following \n into a single \r\n.
    result +=
      markdown.slice(copied, from) + '\r'.repeat(countCarriageReturns(match) - countCarriageReturns(link)) + link;
    copied = from + match.length;
  }
  return result + markdown.slice(copied);
}

/**
 * Where a wiki: href leads: a note by its title, and maybe a heading in it.
 * An empty title is the note the link is in.
 */
export interface WikiTarget {
  title: string;
  heading: string | null;
}

export function wikiTarget(href: string | undefined): WikiTarget | null {
  if (!href?.startsWith(WIKI_PROTOCOL)) return null;
  // Both parts are encoded, so the first # is the one between them.
  const [title = '', heading] = href.slice(WIKI_PROTOCOL.length).split('#', 2);
  try {
    return { title: decodeURIComponent(title), heading: heading ? decodeURIComponent(heading) : null };
  } catch {
    return null;
  }
}

/**
 * When the cursor sits inside an unfinished [[link, returns where the link
 * starts and what has been typed so far.
 */
export function openLinkAt(text: string, cursor: number): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf('[[');
  if (start === -1) return null;
  const query = before.slice(start + 2);
  if (/[[\]\n|]/.test(query) || query.length > 100) return null;
  return { start, query };
}
