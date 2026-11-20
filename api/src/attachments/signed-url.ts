import { createHmac, timingSafeEqual } from 'node:crypto';

/** How long a link to an attachment works. Long enough for a page to load its images. */
export const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

function seal(secret: string, attachmentId: string, userId: string, expires: number): Buffer {
  return createHmac('sha256', secret).update(`attachment:${attachmentId}:${userId}:${expires}`).digest();
}

/**
 * The address of an attachment's file that works without a login for a few
 * minutes: an HMAC over the attachment, its owner and the moment it stops
 * working. An <img src> cannot send the login header, and this needs none.
 * It is good for that one file only, and is worth nothing as a login.
 */
export function signedPath(secret: string, attachmentId: string, userId: string, now = Date.now()): string {
  const expires = now + SIGNED_URL_TTL_MS;
  const signature = seal(secret, attachmentId, userId, expires).toString('base64url');
  return `/api/attachments/${attachmentId}?expires=${expires}&signature=${signature}`;
}

export function signatureIsValid(
  secret: string,
  attachmentId: string,
  userId: string,
  expires: string | undefined,
  signature: string | undefined,
  now = Date.now(),
): boolean {
  if (!expires || !/^\d{13,16}$/.test(expires) || Number(expires) <= now || !signature) return false;
  const given = Buffer.from(signature, 'base64url');
  const expected = seal(secret, attachmentId, userId, Number(expires));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
