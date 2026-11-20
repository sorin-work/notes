const MAX_TERMS = 12;
const MAX_PHRASES = 5;

export interface SearchTerms {
  /** A to_tsquery expression for the loose words, or null when there are none. */
  prefix: string | null;
  /** The text of each quoted phrase, to be read by phraseto_tsquery. */
  phrases: string[];
}

/**
 * Turns loose words into a Postgres tsquery that matches notes containing
 * every word, each as a prefix ("meet" finds "meeting"). Returns null when
 * there is nothing to search for.
 *
 * Only letters and digits are kept, so the result is always valid tsquery
 * syntax however odd the input is.
 */
export function toPrefixQuery(input: string): string | null {
  const terms = input.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!terms) return null;
  const unique = [...new Set(terms)].slice(0, MAX_TERMS);
  return unique.map((term) => `${term}:*`).join(' & ');
}

/**
 * Splits what someone typed into loose words and the phrases in double
 * quotes. The words of a phrase are not prefixes and have to follow each
 * other in that order. A phrase is passed on as plain text, because only
 * Postgres splits it the way it split the notes ("node.js" and "3.5" stay
 * whole there). Returns null when there is nothing to search for.
 */
export function parseSearch(input: string): SearchTerms | null {
  const phrases: string[] = [];
  let loose = '';
  // A quote without a partner matches neither branch and is skipped, so a
  // phrase that is still being typed searches as ordinary words.
  for (const [chunk, quoted] of input.replace(/[“”„]/g, '"').matchAll(/"([^"]*)"|[^"]+/g)) {
    if (quoted === undefined) {
      loose += ` ${chunk}`;
      continue;
    }
    // Postgres does not take control characters such as NUL in text, and they say nothing about a phrase.
    const phrase = quoted.replace(/\p{Cc}+/gu, ' ').trim();
    const searchable = /[\p{L}\p{N}]/u.test(phrase);
    if (searchable && phrases.length < MAX_PHRASES && !phrases.includes(phrase)) phrases.push(phrase);
  }
  const prefix = toPrefixQuery(loose);
  return prefix || phrases.length > 0 ? { prefix, phrases } : null;
}

export const HIGHLIGHT_START = '\u0002';
export const HIGHLIGHT_END = '\u0003';
