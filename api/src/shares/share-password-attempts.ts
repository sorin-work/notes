import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';

const WINDOW_MS = 60_000;
/** Above this many links being guessed at, the ones whose minute is over are cleared out. */
const SWEEP_ABOVE = 1000;

/** The answer once a link has had its wrong passwords for the minute. */
export class TooManyWrongPasswords extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Too many wrong passwords for this link. Try again in a minute.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Counts the wrong passwords sent to a share link, whoever sends them. The
 * ThrottlerGuard counts per client address, which someone guessing from
 * many addresses walks around. Here a link takes AUTH_THROTTLE_LIMIT wrong
 * passwords a minute in total, and then refuses every password until that
 * minute is over.
 *
 * Only wrong passwords use the allowance up, so readers with the right one
 * never close the link to each other. An attempt is taken before the
 * password is checked and given back when it was right. That way attempts
 * that arrive together cannot all be checked before the first is counted.
 *
 * The price: someone who keeps sending wrong passwords can keep the prompt
 * closed to readers for as long as they keep at it. They get no closer to
 * the note by it, and the owner is not held back (SharesService.view).
 *
 * Kept in the memory of this process, like the other throttles.
 */
@Injectable()
export class SharePasswordAttempts {
  private readonly windows = new Map<string, { used: number; until: number }>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /**
   * Takes one attempt from the link's allowance. Answers 0 when there was
   * one to take, otherwise the seconds until the link takes passwords again.
   */
  take(linkId: string, now = Date.now()): number {
    let window = this.windows.get(linkId);
    if (!window || window.until <= now) {
      if (this.windows.size >= SWEEP_ABOVE) this.sweep(now);
      // The minute starts with the first attempt and is not stretched by later ones.
      window = { used: 0, until: now + WINDOW_MS };
      this.windows.set(linkId, window);
    }
    if (window.used >= this.config.authThrottleLimit) {
      return Math.max(1, Math.ceil((window.until - now) / 1000));
    }
    window.used++;
    return 0;
  }

  /** Puts an attempt back: the password was right. */
  giveBack(linkId: string): void {
    const window = this.windows.get(linkId);
    if (window && window.used > 0) window.used--;
  }

  private sweep(now: number): void {
    for (const [linkId, window] of this.windows) {
      if (window.until <= now) this.windows.delete(linkId);
    }
  }
}
