import { ACCESS_TTL_MS, accessIsValid, signAccess } from './share-access';

describe('share access', () => {
  const secret = 'a-secret-that-is-long-enough-0123456789';
  const now = new Date('2026-03-01T12:00:00Z');
  const access = signAccess(secret, 'share-1', 'hash-1', now);

  it('holds for the link and the password it was made for, for an hour', () => {
    expect(accessIsValid(secret, access, 'share-1', 'hash-1', now)).toBe(true);
    expect(accessIsValid(secret, access, 'share-1', 'hash-1', new Date(now.getTime() + ACCESS_TTL_MS - 1))).toBe(true);
    expect(accessIsValid(secret, access, 'share-1', 'hash-1', new Date(now.getTime() + ACCESS_TTL_MS))).toBe(false);
  });

  it('is worth nothing for another link, after the password changed, or with another secret', () => {
    expect(accessIsValid(secret, access, 'share-2', 'hash-1', now)).toBe(false);
    expect(accessIsValid(secret, access, 'share-1', 'hash-2', now)).toBe(false);
    expect(accessIsValid('another-secret-that-is-long-enough-01234', access, 'share-1', 'hash-1', now)).toBe(false);
  });

  it('cannot be stretched or made up', () => {
    const [expires, seal] = access.split('.');
    expect(accessIsValid(secret, `${Number(expires) + 60_000}.${seal}`, 'share-1', 'hash-1', now)).toBe(false);
    for (const forged of [
      undefined,
      '',
      'abc',
      `${expires}.`,
      `${expires}.AAAA`,
      `${expires}.${seal}.x`,
      `x.${seal}`,
    ]) {
      expect(accessIsValid(secret, forged, 'share-1', 'hash-1', now)).toBe(false);
    }
  });
});
