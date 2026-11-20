/**
 * Calendar days and the ways a daily note writes one in its title. The day
 * is worked out here, in the browser, which is the only place that knows
 * what day it is where the user is.
 *
 * Kept in step with api/src/common/day.ts.
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

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** The day the local clock shows, as YYYY-MM-DD. */
export function localDay(now = new Date()): string {
  return `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`;
}

/** A day (YYYY-MM-DD) as a daily note is titled in that format: 2026-11-20, 20 November 2026 or November 20, 2026. */
export function formatDay(day: string, format: DateFormat): string {
  const [year, month, date] = day.split('-').map(Number);
  const name = MONTHS[(month ?? 1) - 1] ?? '';
  if (format === 'long') return `${date} ${name} ${year}`;
  if (format === 'us') return `${name} ${date}, ${year}`;
  return day;
}

/**
 * What to send to open today's note: the day and the values a template may
 * ask for. Not the title: the server writes it in the format the account has
 * now, which a tab opened before it was changed elsewhere would not know.
 */
export function todaysNote(now = new Date()) {
  const date = localDay(now);
  const time = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`;
  return { date, placeholders: { date, time } };
}
