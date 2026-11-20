import { SIGNED_URL_TTL_MS, signatureIsValid, signedPath } from './signed-url';

const SECRET = 'a-secret-that-is-long-enough-0123456789';
const ID = '6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e';
const parts = (path: string) => {
  const url = new URL(path, 'http://x');
  return [url.searchParams.get('expires') ?? undefined, url.searchParams.get('signature') ?? undefined] as const;
};

describe('signed attachment addresses', () => {
  const now = 1_800_000_000_000;

  it('work for that file and owner, until they run out', () => {
    const [expires, signature] = parts(signedPath(SECRET, ID, 'user-1', now));
    expect(Number(expires)).toBe(now + SIGNED_URL_TTL_MS);
    expect(signatureIsValid(SECRET, ID, 'user-1', expires, signature, now)).toBe(true);
    expect(signatureIsValid(SECRET, ID, 'user-1', expires, signature, now + SIGNED_URL_TTL_MS)).toBe(false);
  });

  it('are worth nothing for another file, another owner, another secret or a changed expiry', () => {
    const [expires, signature] = parts(signedPath(SECRET, ID, 'user-1', now));
    expect(signatureIsValid(SECRET, ID.replace('6f', '7f'), 'user-1', expires, signature, now)).toBe(false);
    expect(signatureIsValid(SECRET, ID, 'user-2', expires, signature, now)).toBe(false);
    expect(signatureIsValid(`${SECRET}x`, ID, 'user-1', expires, signature, now)).toBe(false);
    expect(signatureIsValid(SECRET, ID, 'user-1', String(Number(expires) + 1), signature, now)).toBe(false);
    expect(signatureIsValid(SECRET, ID, 'user-1', expires, undefined, now)).toBe(false);
    expect(signatureIsValid(SECRET, ID, 'user-1', 'soon', signature, now)).toBe(false);
  });
});
