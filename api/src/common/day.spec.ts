import { dayTitles, dayToDate, formatDay, parseDay } from './day';

describe('parseDay', () => {
  it('reads a day written as YYYY-MM-DD', () => {
    expect(parseDay('2026-11-20')).toEqual({ year: 2026, month: 11, day: 20 });
    expect(parseDay('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
  });

  it('takes nothing else for a day, and no day that the calendar does not have', () => {
    for (const text of ['2026-02-30', '2026-13-01', '2026-00-10', '2027-02-29', '0000-01-01', '2026-1-5', '20261120']) {
      expect(parseDay(text)).toBeNull();
    }
    expect(parseDay('2026-11-20T10:00:00Z')).toBeNull();
    expect(parseDay(' 2026-11-20')).toBeNull();
  });
});

describe('formatDay', () => {
  const day = { year: 2026, month: 3, day: 5 };

  it('writes the day in each of the formats', () => {
    expect(formatDay(day, 'iso')).toBe('2026-03-05');
    expect(formatDay(day, 'long')).toBe('5 March 2026');
    expect(formatDay(day, 'us')).toBe('March 5, 2026');
    expect(dayTitles(day)).toEqual(['2026-03-05', '5 March 2026', 'March 5, 2026']);
  });

  it('gives the day to the database as midnight UTC', () => {
    expect(dayToDate(day).toISOString()).toBe('2026-03-05T00:00:00.000Z');
  });
});
