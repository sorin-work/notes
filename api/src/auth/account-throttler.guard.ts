import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../common/current-user.decorator';

/**
 * Counts the requests that check the password per account, in one bucket for
 * all the routes it is put on. The plain ThrottlerGuard counts per client
 * address and per route, which leaves a stolen session a full allowance on
 * every route and from every address it can come from. With this one the
 * guesses against an account share AUTH_THROTTLE_LIMIT a minute.
 *
 * Only for routes behind JwtAuthGuard, which runs first and sets the user.
 */
@Injectable()
export class AccountThrottlerGuard extends ThrottlerGuard {
  protected getTracker(request: AuthenticatedRequest): Promise<string> {
    if (!request.user) {
      throw new Error('AccountThrottlerGuard used on a route without JwtAuthGuard');
    }
    return Promise.resolve(request.user.id);
  }

  /** Leaves the route out of the key, so the bucket is shared between routes. */
  protected generateKey(_context: ExecutionContext, userId: string, throttlerName: string): string {
    return `account-password:${throttlerName}:${userId}`;
  }
}
