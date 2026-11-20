import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isDateTime, ShareOptionsDto } from './share.dto';

describe('isDateTime', () => {
  it('takes a date, or a date and time with its zone', () => {
    for (const value of [
      '2027-01-01',
      '2027-01-01T10:00Z',
      '2027-01-01T10:00:00Z',
      '2027-01-01T10:00:00.000Z',
      '2027-01-01T11:00:00+01:00',
      '2028-02-29T23:59:59-05:00',
    ]) {
      expect([value, isDateTime(value)]).toEqual([value, true]);
    }
  });

  it('refuses what cannot be read, or would be read as something else', () => {
    for (const value of [
      'next week',
      '',
      // ISO 8601 forms that new Date() makes nothing of.
      '2027-W01',
      '2027-W01-1',
      '20270101',
      '20270101T100000Z',
      '2027-01-01T10',
      // Forms that new Date() reads, each in its own way.
      '2027',
      '2027-001',
      '+2027-01-01',
      '-2027-01-01',
      '2027-01-01 10:00',
      // No zone: the server's would be assumed.
      '2027-01-01T10:00:00',
      // Days that do not exist.
      '2027-13-45',
      '2027-02-30',
      '2027-02-29T10:00:00Z',
      '2027-01-01T24:00:00Z',
      '2027-01-01T10:00:00+0100',
      1798761600000,
      null,
      undefined,
      {},
    ]) {
      expect([value, isDateTime(value)]).toEqual([value, false]);
    }
  });
});

describe('ShareOptionsDto', () => {
  const errorsOf = async (body: object) =>
    (await validate(plainToInstance(ShareOptionsDto, body))).flatMap((error) => Object.values(error.constraints ?? {}));

  it('answers an unreadable expiry with one clear line', async () => {
    await expect(errorsOf({ expiresAt: '2027-W01' })).resolves.toEqual([
      'expiresAt must be a date and time such as 2026-03-01T12:00:00Z',
    ]);
    await expect(errorsOf({ expiresAt: 20270101 })).resolves.toHaveLength(1);
  });

  it('lets null and nothing through, as "take it away" and "leave it"', async () => {
    await expect(errorsOf({ expiresAt: null, password: null })).resolves.toEqual([]);
    await expect(errorsOf({})).resolves.toEqual([]);
    await expect(errorsOf({ expiresAt: '2027-01-01T10:00:00Z' })).resolves.toEqual([]);
  });
});
