import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * The secrets of two-step sign-in are kept encrypted with AES-256-GCM under
 * TWO_STEP_KEY, which lives in the environment and not in the database. A
 * dump of the database alone, or the JSON backup, which leaves them out
 * anyway, gives nobody the codes.
 *
 * Stored as "v1.<iv>.<tag>.<ciphertext>", each part base64url. The account
 * id is bound in as additional data, so a secret copied onto another
 * account's row does not decrypt there.
 */
const VERSION = 'v1';

export function encryptSecret(key: Buffer, userId: string, secret: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId));
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** Throws when the key is not the one it was encrypted with, or the text was changed. */
export function decryptSecret(key: Buffer, userId: string, stored: string): Buffer {
  const [version, iv, tag, ciphertext] = stored.split('.');
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error('not an encrypted secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
}

/**
 * Recovery codes: 16 letters and digits in groups of four
 * ("k7qm-2xvd-9hpa-c4wt"), 80 random bits. That is enough for a plain
 * SHA-256 to be safe to store, and it needs no key, so the codes still work
 * as a way in if TWO_STEP_KEY is lost.
 */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_LENGTH = 16;

export function newRecoveryCode(): string {
  let code = '';
  // 31 symbols: bytes at 248 and above are thrown away, so every symbol is as likely as the next.
  while (code.length < RECOVERY_LENGTH) {
    for (const byte of randomBytes(RECOVERY_LENGTH)) {
      if (byte < 248 && code.length < RECOVERY_LENGTH) code += RECOVERY_ALPHABET[byte % 31];
    }
  }
  return code.match(/.{4}/g)!.join('-');
}

/** A code as typed: case, spaces and dashes do not matter. */
export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}

export function looksLikeRecoveryCode(code: string): boolean {
  return new RegExp(`^[${RECOVERY_ALPHABET}]{${RECOVERY_LENGTH}}$`).test(normalizeRecoveryCode(code));
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}
