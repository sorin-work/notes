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

/** Where a note mentions a title in plain text, as positions in the note. */
export interface Mention {
  start: number;
  end: number;
}

/** Shorter titles are too common as words ("Go", "AI") to look for. */
const MIN_MENTION_LENGTH = 3;

const blank = (match: string) => ' '.repeat(match.length);

/**
 * Blanks out the places where words are not plain text, and where brackets
 * put around them would break something: [[links]], Markdown links and
 * images, HTML tags and bare URLs.
 */
function withoutLinks(line: string): string {
  return line
    .replace(/\[\[[^\]\n]*\]\]/g, blank)
    .replace(/!?\[[^\]\n]*\](\([^)\n]*\)|\[[^\]\n]*\])/g, blank)
    .replace(/<[^>\n]+>/g, blank)
    .replace(/\bhttps?:\/\/\S+/gi, blank);
}

/**
 * A pattern for `title` written out in a line of text, or null when the
 * title is too short or cannot be written as a [[link]] (with [ ] | # or a
 * backtick in it), since linking a mention would then not work. It matches
 * the way links are matched to notes, ignoring case and extra spaces, and
 * only whole words: "Atlas" is not mentioned in "Atlases".
 */
function mentionPattern(title: string): RegExp | null {
  const key = normalizeTitle(title);
  if (key.length < MIN_MENTION_LENGTH || /[`\r\n]/.test(title)) return null;
  const asLink = extractWikiLinks(`[[${title}]]`);
  if (asLink.length !== 1 || asLink[0].alias !== null || normalizeTitle(asLink[0].title) !== key) return null;
  const words = key.split(' ').map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}_])${words.join('[ \\t]+')}(?![\\p{L}\\p{N}_])`, 'iu');
}

/** Whether mentions of this title are looked for at all. See mentionPattern for which are not. */
export function isMentionable(title: string): boolean {
  return mentionPattern(title) !== null;
}

/**
 * Finds the first place where a note mentions `title` without linking to it.
 * Fenced code blocks and inline code are skipped as in extractWikiLinks, and
 * so is everything withoutLinks blanks out.
 */
export function findMention(markdown: string, title: string): Mention | null {
  const pattern = mentionPattern(title);
  if (!pattern) return null;

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

    // Blanking keeps the length of the line, so a position in it is a position in the note.
    const match = pattern.exec(withoutLinks(withoutInlineCode(line)));
    if (match) return { start: lineStart + match.index, end: lineStart + match.index + match[0].length };
  }
  return null;
}

/**
 * Wraps the first unlinked mention of `title` in [[ ]], keeping the words as
 * they were written. Returns null when there is no mention, and when the
 * result would not read back as the links the note had plus this one.
 */
export function linkMention(markdown: string, title: string): string | null {
  const mention = findMention(markdown, title);
  if (!mention) return null;
  const linked = `${markdown.slice(0, mention.start)}[[${markdown.slice(mention.start, mention.end)}]]${markdown.slice(mention.end)}`;

  const keys = (text: string) => extractWikiLinks(text).map((link) => normalizeTitle(link.title));
  const expected = new Set([...keys(markdown), normalizeTitle(title)]);
  const found = keys(linked);
  return found.length === expected.size && found.every((key) => expected.has(key)) ? linked : null;
}
