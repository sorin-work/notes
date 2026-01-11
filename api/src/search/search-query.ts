const MAX_TERMS = 12;

/**
 * Turns what someone typed into a Postgres tsquery that matches notes
 * containing every word, each as a prefix ("meet" finds "meeting").
 * Returns null when there is nothing to search for.
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

export const HIGHLIGHT_START = '\u0002';
export const HIGHLIGHT_END = '\u0003';
