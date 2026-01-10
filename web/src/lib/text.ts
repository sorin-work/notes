export const HIGHLIGHT_START = '\u0002';
export const HIGHLIGHT_END = '\u0003';

/** Splits a search snippet into plain and highlighted parts. */
export function splitHighlights(snippet: string): { text: string; highlight: boolean }[] {
  const parts: { text: string; highlight: boolean }[] = [];
  for (const [index, piece] of snippet.split(HIGHLIGHT_START).entries()) {
    if (index === 0) {
      if (piece) parts.push({ text: piece, highlight: false });
      continue;
    }
    const end = piece.indexOf(HIGHLIGHT_END);
    if (end === -1) {
      parts.push({ text: piece, highlight: false });
      continue;
    }
    parts.push({ text: piece.slice(0, end), highlight: true });
    if (end + 1 < piece.length) parts.push({ text: piece.slice(end + 1), highlight: false });
  }
  return parts;
}
