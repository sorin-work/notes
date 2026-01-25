export interface WikiLink {
  /** The note title the link points at. */
  title: string;
  /** Text shown instead of the title, from [[Title|alias]]. */
  alias: string | null;
}

const LINK = /\[\[([^[\]\n|#]+)(?:#[^[\]\n|]*)?(?:\|([^[\]\n]+))?\]\]/g;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Case and whitespace insensitive form of a title, used to match links to notes. */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Blanks out `inline code` so links inside it are not picked up. */
function withoutInlineCode(line: string): string {
  return line.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (match) => ' '.repeat(match.length));
}

/**
 * Finds the [[wiki links]] in a note, skipping fenced code blocks and inline
 * code. Each target title appears once, in the order first linked.
 */
export function extractWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  const seen = new Set<string>();
  let fence: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker;
        continue;
      }
      if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
        continue;
      }
    }
    if (fence !== null) continue;

    for (const match of withoutInlineCode(line).matchAll(LINK)) {
      const title = match[1].trim().replace(/\s+/g, ' ');
      const key = normalizeTitle(title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      links.push({ title, alias: match[2]?.trim() || null });
    }
  }
  return links;
}
