/** Kept in step with api/src/links/wikilinks.ts. */
const LINK = /\[\[([^[\]\n|#]+)(?:#[^[\]\n|]*)?(?:\|([^[\]\n]+))?\]\]/g;

export const WIKI_PROTOCOL = 'wiki:';

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Rewrites [[Title]] and [[Title|text]] as Markdown links with a wiki: URL so
 * the preview can render them as in-app links.
 */
export function linkifyWikiLinks(markdown: string): string {
  return markdown.replace(LINK, (_match, title: string, alias?: string) => {
    const target = title.trim().replace(/\s+/g, ' ');
    const label = (alias ?? target).trim().replace(/[[\]]/g, '\\$&');
    return `[${label}](${WIKI_PROTOCOL}${encodeURIComponent(target)})`;
  });
}

export function wikiTarget(href: string | undefined): string | null {
  if (!href?.startsWith(WIKI_PROTOCOL)) return null;
  try {
    return decodeURIComponent(href.slice(WIKI_PROTOCOL.length));
  } catch {
    return null;
  }
}
