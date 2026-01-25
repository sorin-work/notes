/** Kept in step with api/src/links/wikilinks.ts. */
const LINK = /\[\[([^[\]\n|#]+)(?:#[^[\]\n|]*)?(?:\|([^[\]\n]+))?\]\]/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const INLINE_CODE = /(`+)([\s\S]*?[^`])\1(?!`)/g;

export const WIKI_PROTOCOL = 'wiki:';

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Calls `fn` for each line that is not inside a fenced code block. */
function mapProseLines(markdown: string, fn: (line: string) => string): string {
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const match = FENCE.exec(line);
      if (match) {
        const marker = match[1] ?? '';
        if (fence === null) {
          fence = marker;
          return line;
        }
        if (marker[0] === fence[0] && marker.length >= fence.length) {
          fence = null;
          return line;
        }
      }
      return fence === null ? fn(line) : line;
    })
    .join('\n');
}

/** Runs `fn` on the parts of a line that are not inline code. */
function outsideInlineCode(line: string, fn: (text: string) => string): string {
  let result = '';
  let last = 0;
  for (const match of line.matchAll(INLINE_CODE)) {
    result += fn(line.slice(last, match.index)) + match[0];
    last = (match.index ?? 0) + match[0].length;
  }
  return result + fn(line.slice(last));
}

/**
 * Rewrites [[Title]] and [[Title|text]] as Markdown links with a wiki: URL so
 * the preview can render them as in-app links. Code is left alone.
 */
export function linkifyWikiLinks(markdown: string): string {
  return mapProseLines(markdown, (line) =>
    outsideInlineCode(line, (text) =>
      text.replace(LINK, (_match, title: string, alias?: string) => {
        const target = title.trim().replace(/\s+/g, ' ');
        const label = (alias ?? target).trim().replace(/[[\]]/g, '\\$&');
        return `[${label}](${WIKI_PROTOCOL}${encodeURIComponent(target)})`;
      }),
    ),
  );
}

export function wikiTarget(href: string | undefined): string | null {
  if (!href?.startsWith(WIKI_PROTOCOL)) return null;
  try {
    return decodeURIComponent(href.slice(WIKI_PROTOCOL.length));
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
