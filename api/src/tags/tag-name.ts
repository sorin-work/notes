export const MAX_TAG_LENGTH = 40;

/** "  #Book Club " -> "book-club". Returns null for names that end up empty. */
export function normalizeTagName(name: string): string | null {
  const normalized = name
    .trim()
    .replace(/^#+/, '')
    .toLowerCase()
    .replace(/[\s,]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, MAX_TAG_LENGTH);
  return normalized || null;
}

/** Normalised, de-duplicated tag names in their original order. */
export function normalizeTagNames(names: string[]): string[] {
  const result: string[] = [];
  for (const name of names) {
    const normalized = normalizeTagName(name);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}
