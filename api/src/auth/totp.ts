import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * One-time codes as authenticator apps make them (TOTP, RFC 6238, on top of
 * HOTP, RFC 4226): HMAC-SHA1 of the number of 30-second steps since 1970,
 * cut down to six digits. Every app knows these settings, so they are the
 * only ones offered.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Codes of one step before and after the current one are taken too, for clocks that are a little off. */
export const TOTP_DRIFT_STEPS = 1;
/** 160 bits, the size RFC 4226 recommends for HMAC-SHA1. */
export const TOTP_SECRET_BYTES = 20;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 without padding (RFC 4648), the way authenticator apps take a secret. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The other way round. Spaces, dashes, padding and case are ignored. Throws on anything else. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): Buffer {
  return randomBytes(TOTP_SECRET_BYTES);
}

/** The step a moment falls in. */
export function stepAt(now: Date): number {
  return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** The code of one step (HOTP with the step as the counter). */
export function codeAt(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return binary.toString().padStart(TOTP_DIGITS, '0');
}

/** Whether a string has the shape of a code at all: six digits, with spaces allowed in between. */
export function looksLikeTotp(code: string): boolean {
  return /^\d{6}$/.test(code.replace(/\s/g, ''));
}

/**
 * The step whose code `code` is, looking one step either side of `now`, or
 * null. Every candidate is compared, in constant time, so the answer takes
 * the same time whichever step matched. Whether the step was used before is
 * for the caller to check.
 */
export function matchingStep(secret: Buffer, code: string, now: Date): number | null {
  const given = Buffer.from(code.replace(/\s/g, ''));
  const current = stepAt(now);
  let found: number | null = null;
  for (let step = current - TOTP_DRIFT_STEPS; step <= current + TOTP_DRIFT_STEPS; step++) {
    const expected = Buffer.from(codeAt(secret, step));
    if (given.length === expected.length && timingSafeEqual(given, expected) && found === null) {
      found = step;
    }
  }
  return found;
}

/**
 * What the QR code in Settings holds: the address authenticator apps read.
 * The account is named by its email so that someone with several accounts
 * can tell them apart in the app.
 */
export function otpauthUri(secret: Buffer, email: string, issuer = 'Notes'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
