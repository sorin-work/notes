import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * Counts password attempts per share link, whoever makes them. The plain
 * ThrottlerGuard counts per client address, which someone guessing from
 * many addresses walks around. With both, a link gets AUTH_THROTTLE_LIMIT
 * attempts a minute in total.
 *
 * The price: a stranger can use the attempts up and keep readers out for
 * the rest of the minute. They get no closer to the note by it.
 */
@Injectable()
export class ShareLinkThrottlerGuard extends ThrottlerGuard {
  protected getTracker(request: Request): Promise<string> {
    return Promise.resolve(String(request.params.token));
  }

  /** Leaves the client out of the key: the bucket belongs to the link. */
  protected generateKey(_context: ExecutionContext, token: string, throttlerName: string): string {
    return `share-password:${throttlerName}:${token}`;
  }
}
