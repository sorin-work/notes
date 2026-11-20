import { proseSpans, Span, verbatimParts } from './prose';

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

/** The lines of a note outside fenced code blocks, each with where it starts in the note. */
function* proseLines(markdown: string): Generator<{ line: string; lineStart: number }> {
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
    if (fence === null) yield { line, lineStart };
  }
}

/** Every [[wiki link]] in a note, in order, skipping fenced code blocks and inline code. */
function* findLinks(markdown: string): Generator<LinkInText> {
  for (const { line, lineStart } of proseLines(markdown)) {
    // Blanking keeps the length of the line, so positions in it are positions in the note.
    for (const match of withoutInlineCode(line).matchAll(LINK)) {
      const start = lineStart + match.index + 2;
      const end = start + match[1].length;
      yield {
        title: match[1].trim().replace(/\s+/g, ' '),
        alias: match[2]?.trim() || null,
        start,
        end,
        plain: markdown.slice(start, end) === match[1],
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

/** Where a note mentions a title in plain text, as positions in the note. */
export interface Mention {
  start: number;
  end: number;
}

/** Shorter titles are too common as words ("Go", "AI") to look for. */
const MIN_MENTION_LENGTH = 3;

/**
 * A pattern for `title` written out in text, or null when the title is too
 * short or cannot be written as a [[link]] (with [ ] | # or a backtick in
 * it), since linking a mention would then not work. It matches the way links
 * are matched to notes, ignoring case and extra spaces, and only whole
 * words: "Atlas" is not mentioned in "Atlases". A word is made of letters,
 * the marks that belong to them, digits and the underscore. Without the
 * marks "राम" would be found at the start of "रामायण", which is another word.
 */
function mentionPattern(title: string): RegExp | null {
  const key = normalizeTitle(title);
  if (key.length < MIN_MENTION_LENGTH || !isLinkable(title)) return null;
  const words = key.split(' ').map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const inWord = '[\\p{L}\\p{M}\\p{N}_]';
  return new RegExp(`(?<!${inWord})${words.join('[ \\t]+')}(?!${inWord})`, 'giu');
}

/** Whether mentions of this title are looked for at all. See mentionPattern for which are not. */
export function isMentionable(title: string): boolean {
  return mentionPattern(title) !== null;
}

/**
 * Every [[ with its ]] on the same line, as positions. Each character is
 * looked at a fixed number of times, however many brackets a note has.
 */
function wikiLinkSpans(text: string): Span[] {
  const spans: Span[] = [];
  let close = -1;
  for (let open = text.indexOf('[['); open !== -1;) {
    if (close < open + 2) close = text.indexOf(']]', open + 2);
    if (close === -1) break;
    const lineEnd = text.indexOf('\n', open);
    if (lineEnd !== -1 && lineEnd < close) {
      // Not closed on its line, so it is no link. The next one cannot start before the line ends.
      open = text.indexOf('[[', lineEnd);
      continue;
    }
    spans.push({ from: open, to: close + 2 });
    open = text.indexOf('[[', close + 2);
  }
  return spans;
}

/**
 * The places where a note mentions `title` without linking to it, in order.
 * A mention lies inside one stretch of plain text as proseSpans finds them,
 * so never in code, in the text or target of a link, in a URL or in HTML,
 * and never inside an existing [[link]].
 */
export function findMentions(markdown: string, title: string): Mention[] {
  const pattern = mentionPattern(title);
  if (!pattern) return [];
  const prose = proseSpans(markdown);
  if (prose.length === 0) return [];
  const links = wikiLinkSpans(markdown);
  const key = normalizeTitle(title);

  const mentions: Mention[] = [];
  let p = 0;
  let l = 0;
  for (const match of markdown.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    // The matches and both lists are in order, so each list is walked once.
    while (p < prose.length && prose[p].to < end) p++;
    if (p === prose.length) break;
    if (prose[p].from > start) continue;
    while (l < links.length && links[l].to <= start) l++;
    if (l < links.length && links[l].from < end) continue;
    // The pattern folds case the way regular expressions do. The key of a link is what counts.
    if (normalizeTitle(match[0]) !== key) continue;
    mentions.push({ start, end });
  }
  return mentions;
}

/** The first place where a note mentions `title` without linking to it, if there is one. */
export function findMention(markdown: string, title: string): Mention | null {
  return findMentions(markdown, title)[0] ?? null;
}

/**
 * Wraps one unlinked mention of `title` in [[ ]], keeping the words as they
 * were written: the first one, or the one that starts at `at.offset` and
 * reads `at.text`. Returns null when there is no such mention.
 *
 * The result is read back before it is returned. It has to hold the links
 * the note had plus this one, and every code span, code block, URL and piece
 * of HTML exactly as before. Otherwise nothing is changed.
 */
export function linkMention(markdown: string, title: string, at?: { offset: number; text: string }): string | null {
  const mentions = findMentions(markdown, title);
  const mention = at ? mentions.find((found) => found.start === at.offset) : mentions[0];
  if (!mention) return null;
  const written = markdown.slice(mention.start, mention.end);
  if (at && written !== at.text) return null;
  const linked = `${markdown.slice(0, mention.start)}[[${written}]]${markdown.slice(mention.end)}`;

  const keys = (text: string) => extractWikiLinks(text).map((link) => normalizeTitle(link.title));
  const expected = new Set([...keys(markdown), normalizeTitle(title)]);
  const found = keys(linked);
  if (found.length !== expected.size || !found.every((key) => expected.has(key))) return null;

  const before = verbatimParts(markdown);
  const after = verbatimParts(linked);
  if (before.length !== after.length || before.some((part, index) => part !== after[index])) return null;
  return linked;
}
