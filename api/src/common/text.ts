/**
 * A plain-text preview of a note's Markdown for the note list: code blocks,
 * images and formatting removed, links reduced to their text.
 */
export function excerpt(markdown: string, maxLength = 160): string {
  const text = markdown
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, ' ')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Tidies a search snippet: drops Markdown punctuation and collapses whitespace. */
export function cleanSnippet(snippet: string): string {
  return snippet
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, ' ')
    .replace(/[|#>*`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
