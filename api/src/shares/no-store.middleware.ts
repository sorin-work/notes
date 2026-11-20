import type { NextFunction, Request, Response } from 'express';

/**
 * Tells browsers and proxies to keep no copy of the answer.
 *
 * A middleware, because it runs before everything that can refuse a
 * request: a 429 from a throttle guard or a 400 from validation never gets
 * as far as the handler, and would go out without a header set there.
 */
export function noStore(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
