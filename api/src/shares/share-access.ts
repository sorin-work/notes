import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a reader goes on reading after giving the password once. */
export const ACCESS_TTL_MS = 60 * 60 * 1000;

function seal(secret: string, shareId: string, passwordHash: string, expires: number): Buffer {
  return createHmac('sha256', secret).update(`share-access:${shareId}:${expires}:${passwordHash}`).digest();
}

/**
 * What a reader gets for the right password: proof of it, to send along
 * with the next requests in a header instead of the password itself.
 *
 * It exists because of notebooks. Every password attempt counts against a
 * small allowance per link, and reading ten notes of a protected notebook
 * would otherwise be ten attempts.
 *
 * It is good for one link and for the password that link has now: change or
 * remove the password and every proof handed out before is worth nothing.
 */
export function signAccess(secret: string, shareId: string, passwordHash: string, now = new Date()): string {
  const expires = now.getTime() + ACCESS_TTL_MS;
  return `${expires}.${seal(secret, shareId, passwordHash, expires).toString('base64url')}`;
}

export function accessIsValid(
  secret: string,
  access: string | undefined,
  shareId: string,
  passwordHash: string,
  now = new Date(),
): boolean {
  const [expires, seal64, ...rest] = (access ?? '').split('.');
  if (!seal64 || rest.length > 0 || !/^\d{13,16}$/.test(expires)) return false;
  if (Number(expires) <= now.getTime()) return false;
  const given = Buffer.from(seal64, 'base64url');
  const expected = seal(secret, shareId, passwordHash, Number(expires));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
