export interface WikiLink {
  /** The note title the link points at. */
  title: string;
  /** Text shown instead of the title, from [[Title|alias]]. */
  alias: string | null;
}

/** A [[link]] where it stands in a note. */
interface LinkInText extends WikiLink {
  /** Where the title starts in the text, after the opening brackets. */
  start: number;
  /** Where the title ends, before any #heading, |alias or the closing brackets. */
  end: number;
  /** False when inline code sits between the brackets, so the title is not the text that is written there. */
  plain: boolean;
  /** Where the whole link starts, at its opening brackets. */
  from: number;
  /** Where the whole link ends, after its closing brackets. */
  to: number;
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

/** Every [[wiki link]] in a note, in order, skipping fenced code blocks and inline code. */
function* findLinks(markdown: string): Generator<LinkInText> {
  let fence: string | null = null;
  let offset = 0;
  // Lines sit at the even indexes, the line endings between them at the odd ones.
  const parts = markdown.split(/(\r?\n)/);
  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const lineStart = offset;
    offset += line.length + (parts[index + 1]?.length ?? 0);

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

    // Blanking keeps the length of the line, so positions in it are positions in the note.
    for (const match of withoutInlineCode(line).matchAll(LINK)) {
      const from = lineStart + match.index;
      const start = from + 2;
      const end = start + match[1].length;
      yield {
        title: match[1].trim().replace(/\s+/g, ' '),
        alias: match[2]?.trim() || null,
        start,
        end,
        plain: markdown.slice(start, end) === match[1],
        from,
        to: from + match[0].length,
      };
    }
  }
}

/**
 * Finds the [[wiki links]] in a note, skipping fenced code blocks and inline
 * code. Each target title appears once, in the order first linked.
 */
export function extractWikiLinks(markdown: string): WikiLink[] {
  const links: WikiLink[] = [];
  const seen = new Set<string>();
  for (const { title, alias } of findLinks(markdown)) {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    links.push({ title, alias });
  }
  return links;
}

/**
 * Whether [[title]] can be written into any note and read back as a link to
 * that title. A title with [ ] | or # in it cannot, and one with a backtick
 * could pair up with another backtick on the line and turn the link into code.
 * A line break is refused as well: a lone \r would pass as a space, but it
 * has no business being written into other notes.
 */
export function isLinkable(title: string): boolean {
  const key = normalizeTitle(title);
  if (!key || /[`\r\n]/.test(title)) return false;
  const links = [...findLinks(`[[${title}]]`)];
  return links.length === 1 && links[0].alias === null && normalizeTitle(links[0].title) === key;
}

/**
 * Points the [[links]] to `from` at `to`. Titles are matched the way links
 * are matched to notes, ignoring case and extra spaces, and code is skipped
 * as in extractWikiLinks. Only the title between the brackets is replaced, so
 * a #heading, an |alias and everything else in the note stay as written.
 *
 * Returns the text unchanged when `to` cannot be written as a link, and when
 * the result would not read back as the same links with just that title
 * swapped.
 */
export function renameLinks(markdown: string, from: string, to: string): string {
  const fromKey = normalizeTitle(from);
  const toKey = normalizeTitle(to);
  if (!fromKey || !isLinkable(to)) return markdown;

  let renamed = '';
  let copied = 0;
  const expected: string[] = [];
  for (const link of findLinks(markdown)) {
    const key = normalizeTitle(link.title);
    // With code between the brackets there is no telling what to replace. That link stays.
    const rename = key === fromKey && link.plain;
    if (rename) {
      renamed += markdown.slice(copied, link.start) + to;
      copied = link.end;
    }
    expected.push(rename ? toKey : key);
  }
  if (copied === 0) return markdown;
  renamed += markdown.slice(copied);

  const found = [...findLinks(renamed)].map((link) => normalizeTitle(link.title));
  return found.length === expected.length && found.every((key, index) => key === expected[index]) ? renamed : markdown;
}

/**
 * A note as readers of a share link get it. `keep` says, by normalised
 * title, whether a link leads somewhere they may go. Those links stay as
 * they are. Every other link is replaced by the words a reader sees for it,
 * the alias or else the title as it is written, so that what is sent holds
 * neither a title hidden behind an alias nor a hint which of the other
 * titles exist.
 */
export function unlinkExcept(markdown: string, keep: (key: string) => boolean): string {
  let result = '';
  let copied = 0;
  for (const link of findLinks(markdown)) {
    if (link.plain && keep(normalizeTitle(link.title))) continue;
    result += markdown.slice(copied, link.from) + (link.alias ?? markdown.slice(link.start, link.end).trim());
    copied = link.to;
  }
  return result + markdown.slice(copied);
}
