import { maskNonProse } from './mask';
import { parseNote, ParsedNote, Span } from './prose';

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

/**
 * Kept in step with web/src/lib/wikilinks.ts. The web app also reads
 * [[#Heading]] and [[ #Heading]], links to a heading of the same note. Here
 * a link needs a title that is not blank, since only links to other notes
 * are stored and rewritten (see findLinks).
 */
const LINK = /\[\[([^[\]\n|#]+)(?:#[^[\]\n|]*)?(?:\|([^[\]\n]+))?\]\]/g;

/** Case and whitespace insensitive form of a title, used to match links to notes. */
export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Every [[wiki link]] in a note, in order, skipping code and math (see maskNonProse). */
function* findLinks(markdown: string): Generator<LinkInText> {
  // Blanking keeps the length of the note, so positions in it are positions in the note.
  for (const match of maskNonProse(markdown).matchAll(LINK)) {
    const from = match.index;
    const start = from + 2;
    const end = start + match[1].length;
    const to = from + match[0].length;
    // A blank title, as in [[ #Heading]], is a link within the note, which the web app reads.
    // It leads to no other note, so it is left as it is written everywhere here.
    if (!match[1].trim()) continue;
    // From the note itself, not the blanked line: inline code in an alias is part of what is shown.
    const alias = match[2] === undefined ? null : markdown.slice(to - 2 - match[2].length, to - 2).trim();
    yield {
      title: match[1].trim().replace(/\s+/g, ' '),
      alias: alias || null,
      start,
      end,
      plain: markdown.slice(start, end) === match[1],
      from,
      to,
    };
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

/** The first line ending at or after `from`, or -1. A lone \r ends a line too. */
function lineEndFrom(text: string, from: number): number {
  const n = text.indexOf('\n', from);
  const r = text.indexOf('\r', from);
  return n === -1 ? r : r === -1 ? n : Math.min(n, r);
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
    const lineEnd = lineEndFrom(text, open);
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
 * Whether the note writes the title anywhere at all, as a word. It is only
 * a pattern run over the text, so a note that does not can be passed over
 * without being parsed.
 */
export function mayMention(markdown: string, title: string): boolean {
  const pattern = mentionPattern(title);
  return pattern !== null && pattern.test(markdown);
}

/**
 * The places where a note mentions `title` without linking to it, in order.
 * A mention lies inside one stretch of plain text as parseNote finds them,
 * so never in code, in the label or target of a link or image, in a URL or
 * in HTML, and never inside an existing [[link]].
 */
export function findMentions(markdown: string, title: string, parsed?: ParsedNote | null): Mention[] {
  const pattern = mentionPattern(title);
  if (!pattern || !pattern.test(markdown)) return [];
  pattern.lastIndex = 0;
  const prose = (parsed === undefined ? parseNote(markdown) : parsed)?.prose ?? [];
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

/**
 * Whether a mention can be ruled out from the tree of the note alone,
 * without parsing anything again: after a "!" the brackets would open an
 * image, which the preview shows broken, and around the label of a
 * reference definition they would make a reference link.
 */
function ruledOut(markdown: string, mention: Mention, parsed: ParsedNote): boolean {
  if (markdown[mention.start - 1] === '!') return true;
  return parsed.labels.includes(normalizeTitle(markdown.slice(mention.start, mention.end)));
}

/**
 * Whether `linked` is `markdown` with [[ ]] put around `mention` and nothing
 * else changed, as the parser reads both. The new text is parsed again and
 * has to hold exactly the [[links]] the note had plus one, at that place
 * and in plain text, every piece of code, HTML, every link, image,
 * reference and definition byte for byte as before, and every emphasis,
 * strong and strikethrough where it was: brackets next to a `*`, `_` or `~`
 * can change how those pair up. When the parser reads the brackets some
 * other way, as the label of a link to a reference definition say, this
 * says no.
 */
export function onlyAddsLink(markdown: string, linked: string, mention: Mention, parsed?: ParsedNote | null): boolean {
  const { start, end } = mention;
  if (linked !== `${markdown.slice(0, start)}[[${markdown.slice(start, end)}]]${markdown.slice(end)}`) return false;
  const before = parsed === undefined ? parseNote(markdown) : parsed;
  if (!before || ruledOut(markdown, mention, before)) return false;
  const after = parseNote(linked);
  if (!after) return false;

  if (before.verbatim.length !== after.verbatim.length) return false;
  if (before.verbatim.some((part, index) => part !== after.verbatim[index])) return false;

  // Formatting stays where it was, moved along by the brackets.
  const shift = (at: number) => (at <= start ? at : at >= end ? at + 4 : at + 2);
  const formatting = before.formatting.map((node) => {
    const [type, from, to] = node.split(':');
    return `${type}:${shift(Number(from))}:${shift(Number(to))}`;
  });
  if (formatting.length !== after.formatting.length) return false;
  if (formatting.some((node, index) => node !== after.formatting[index])) return false;

  // The new link sits inside one stretch of plain text, brackets and all.
  if (!after.prose.some((span) => span.from <= start && end + 4 <= span.to)) return false;

  const moved = (at: number) => (at >= end ? at + 4 : at);
  const expected = [...findLinks(markdown)].map((link) => `${moved(link.start)}:${normalizeTitle(link.title)}`);
  const added = `${start + 2}:${normalizeTitle(markdown.slice(start, end))}`;
  const index = expected.findIndex((link) => Number(link.split(':')[0]) > start + 2);
  expected.splice(index === -1 ? expected.length : index, 0, added);
  const found = [...findLinks(linked)].map((link) => `${link.start}:${normalizeTitle(link.title)}`);
  return found.length === expected.length && found.every((link, at) => link === expected[at]);
}

/**
 * Wraps one unlinked mention of `title` in [[ ]], keeping the words as they
 * were written: the one that starts at `at.offset` and reads `at.text`, or
 * without `at` the first one that is not ruled out from the tree. Returns
 * the mention and the new text, or null when there is no such mention or
 * onlyAddsLink refuses it.
 *
 * The note is parsed once, or not at all when `parsed` holds its tree
 * already, and the new text once more. The list and "Link" both use this,
 * so they agree on what can be linked.
 */
export function linkableMention(
  markdown: string,
  title: string,
  at?: { offset: number; text: string },
  parsed?: ParsedNote | null,
): (Mention & { linked: string }) | null {
  if (!mayMention(markdown, title)) return null;
  const tree = parsed === undefined ? parseNote(markdown) : parsed;
  if (!tree) return null;
  const mention = findMentions(markdown, title, tree).find((found) =>
    at ? found.start === at.offset : !ruledOut(markdown, found, tree),
  );
  if (!mention) return null;
  const written = markdown.slice(mention.start, mention.end);
  if (at && written !== at.text) return null;
  const linked = `${markdown.slice(0, mention.start)}[[${written}]]${markdown.slice(mention.end)}`;
  return onlyAddsLink(markdown, linked, mention, tree) ? { ...mention, linked } : null;
}

/** The first mention that can be linked, if there is one. */
export function findMention(markdown: string, title: string): Mention | null {
  const found = linkableMention(markdown, title);
  return found && { start: found.start, end: found.end };
}

/** The text with one mention of `title` linked, as linkableMention picks it, or null. */
export function linkMention(markdown: string, title: string, at?: { offset: number; text: string }): string | null {
  return linkableMention(markdown, title, at)?.linked ?? null;
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
