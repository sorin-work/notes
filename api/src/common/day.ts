/**
 * Calendar days and the ways a daily note writes one in its title. A day
 * always comes from the browser as YYYY-MM-DD: only it knows what day it is
 * where the user is. Nothing in here asks the clock.
 *
 * Kept in step with web/src/lib/days.ts.
 */
export const DATE_FORMATS = ['iso', 'long', 'us'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

interface Day {
  year: number;
  month: number;
  day: number;
}

/** Reads YYYY-MM-DD. Null for anything else, and for days no calendar has, such as 2026-02-30. */
export function parseDay(text: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real && year >= 1 ? { year, month, day } : null;
}

/** The day as a daily note is titled in that format: 2026-11-20, 20 November 2026 or November 20, 2026. */
export function formatDay({ year, month, day }: Day, format: DateFormat): string {
  const name = MONTHS[month - 1];
  if (format === 'long') return `${day} ${name} ${year}`;
  if (format === 'us') return `${name} ${day}, ${year}`;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The titles the day has across all formats, so a note titled in one is found after the format was changed. */
export function dayTitles(day: Day): string[] {
  return DATE_FORMATS.map((format) => formatDay(day, format));
}

/** The day for a DATE column: midnight UTC, which is how the database client reads and writes one. */
export function dayToDate({ year, month, day }: Day): Date {
  return new Date(Date.UTC(year, month - 1, day));
}
