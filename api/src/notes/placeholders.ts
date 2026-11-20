/** What a template can ask to have filled in. The set is closed on purpose. */
export const PLACEHOLDERS = ['date', 'time', 'title'] as const;
export type PlaceholderValues = Partial<Record<(typeof PLACEHOLDERS)[number], string>>;

const PLACEHOLDER = new RegExp(`\\{\\{\\s*(${PLACEHOLDERS.join('|')})\\s*\\}\\}`, 'g');

/**
 * Puts the values in for {{date}}, {{time}} and {{title}}. The values come
 * with the request as plain text: only the browser knows what day it is where
 * the user is. A placeholder that has no value, and anything else in double
 * braces, is left as it was written.
 */
export function fillPlaceholders(text: string, values: PlaceholderValues): string {
  return text.replace(PLACEHOLDER, (written, name: keyof PlaceholderValues) => values[name] ?? written);
}
