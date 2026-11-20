import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/config';

/** How long a download link works. It is meant to be followed at once. */
export const TICKET_TTL_MS = 60 * 1000;

/**
 * One-time tickets for downloading a backup through a plain link. A link
 * the browser follows itself saves the file straight to disk as it streams
 * in; a download made with fetch would hold the whole file in memory first.
 * The link cannot carry the login header, so it carries a ticket: who it is
 * for, when it stops working and a random part, sealed with an HMAC. Each
 * ticket works once, and only for this download.
 */
@Injectable()
export class DownloadTickets {
  /** Tickets used already, until they would have run out anyway. Kept in the memory of this process. */
  private readonly used = new Map<string, number>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  issue(userId: string, now = Date.now()): string {
    const expires = now + TICKET_TTL_MS;
    const nonce = randomBytes(16).toString('base64url');
    return `${userId}.${expires}.${nonce}.${this.seal(userId, expires, nonce).toString('base64url')}`;
  }

  /** The user a ticket is for, once. Null for a ticket that is wrong, has run out or was used. */
  redeem(ticket: string | undefined, now = Date.now()): string | null {
    const [userId, expires, nonce, seal, ...rest] = (ticket ?? '').split('.');
    if (!userId || !nonce || !seal || rest.length > 0 || !/^\d{13,16}$/.test(expires ?? '')) return null;
    if (Number(expires) <= now) return null;
    const given = Buffer.from(seal, 'base64url');
    const expected = this.seal(userId, Number(expires), nonce);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    for (const [key, until] of this.used) if (until <= now) this.used.delete(key);
    if (this.used.has(nonce)) return null;
    this.used.set(nonce, Number(expires));
    return userId;
  }

  private seal(userId: string, expires: number, nonce: string): Buffer {
    return createHmac('sha256', this.config.jwtSecret).update(`backup-download:${userId}:${expires}:${nonce}`).digest();
  }
}
