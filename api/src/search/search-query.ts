const MAX_TERMS = 12;
const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Turns what someone typed into a Postgres tsquery that matches notes
 * containing every word, each as a prefix ("meet" finds "meeting"). Words in
 * double quotes are a phrase: they are not prefixes and have to follow each
 * other in that order. Returns null when there is nothing to search for.
 *
 * Only letters and digits are kept and the operators are added here, so the
 * result is always valid tsquery syntax however odd the input is.
 */
export function toPrefixQuery(input: string): string | null {
  const parts = new Set<string>();
  let left = MAX_TERMS;
  const add = (part: string, words: number) => {
    if (words === 0 || parts.has(part)) return;
    parts.add(part);
    left -= words;
  };

  // A quote without a partner matches neither branch and is skipped, so a
  // phrase that is still being typed searches as ordinary words.
  const chunks = input
    .toLowerCase()
    .replace(/[“”„]/g, '"')
    .matchAll(/"([^"]*)"|[^"]+/g);
  for (const [chunk, phrase] of chunks) {
    if (phrase === undefined) {
      for (const word of chunk.match(WORD) ?? []) {
        if (left > 0) add(`${word}:*`, 1);
      }
    } else {
      const words = (phrase.match(WORD) ?? []).slice(0, left);
      add(words.length > 1 ? `(${words.join(' <-> ')})` : (words[0] ?? ''), words.length);
    }
  }
  return parts.size > 0 ? [...parts].join(' & ') : null;
}

export const HIGHLIGHT_START = '\u0002';
export const HIGHLIGHT_END = '\u0003';
