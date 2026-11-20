import { describe, expect, it } from 'vitest';
import { DATE_FORMATS, formatDay, localDay, todaysNote } from './days';

describe('days', () => {
  it('takes the day from the local clock, also just before and just after midnight', () => {
    // Built from local parts, so the test holds in any time zone.
    expect(localDay(new Date(2026, 10, 20, 23, 59, 59))).toBe('2026-11-20');
    expect(localDay(new Date(2026, 10, 21, 0, 0, 1))).toBe('2026-11-21');
    expect(localDay(new Date(2026, 0, 5, 9, 0))).toBe('2026-01-05');
  });

  it('writes a day in each of the formats a daily note can have', () => {
    expect(DATE_FORMATS.map((format) => formatDay('2026-03-05', format))).toEqual([
      '2026-03-05',
      '5 March 2026',
      'March 5, 2026',
    ]);
  });

  it('puts together what the server needs to open today’s note', () => {
    expect(todaysNote('long', new Date(2026, 10, 20, 8, 5))).toEqual({
      date: '2026-11-20',
      title: '20 November 2026',
      placeholders: { date: '2026-11-20', time: '08:05' },
    });
  });
});
