import { afterEach, describe, expect, it } from 'vitest';
import { DATE_FORMATS, formatDay, localDay, todaysNote } from './days';

const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

describe('days', () => {
  it('takes the day from the local clock, not from UTC', () => {
    // Far from UTC on both sides, at instants where the local day and the UTC day differ.
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14
    const lateInUtc = new Date('2026-07-20T12:30:00Z');
    expect(lateInUtc.toISOString().slice(0, 10)).toBe('2026-07-20');
    expect(localDay(lateInUtc)).toBe('2026-07-21');

    process.env.TZ = 'Pacific/Pago_Pago'; // UTC-11
    const earlyInUtc = new Date('2026-07-21T05:00:00Z');
    expect(localDay(earlyInUtc)).toBe('2026-07-20');
    expect(localDay(new Date('2026-01-01T09:59:00Z'))).toBe('2025-12-31');
  });

  it('writes a day in each of the formats a daily note can have', () => {
    expect(DATE_FORMATS.map((format) => formatDay('2026-03-05', format))).toEqual([
      '2026-03-05',
      '5 March 2026',
      'March 5, 2026',
    ]);
  });

  it('puts together what the server needs to open today’s note, which is not the title', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    expect(todaysNote(new Date('2026-11-20T18:05:00Z'))).toEqual({
      date: '2026-11-21',
      placeholders: { date: '2026-11-21', time: '08:05' },
    });
  });
});
