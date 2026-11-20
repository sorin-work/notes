import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { ALLOW_API_TOKEN } from '../common/allow-api-token.decorator';
import type { AuthenticatedRequest, AuthUser } from '../common/current-user.decorator';
import { IS_PUBLIC } from '../common/public.decorator';
import { ApiTokensService, isApiToken } from './api-tokens.service';
import { AuthService } from './auth.service';

/** What a read-only API token may send. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Registered globally: every route needs a valid bearer token unless it is
 * marked with @Public().
 *
 * A token is only good while its version matches the account's
 * tokenVersion, which is how a password change or "sign out everywhere"
 * ends sessions before their token expires. That costs one primary-key
 * lookup of two columns on every authenticated request (AuthService.identify).
 *
 * A bearer value that starts with "nt_" is a personal API token instead. It
 * is looked up by its hash, and everything a token may not do is refused
 * here, in one place: any route that is not marked @AllowApiToken(), and
 * anything but reading for a read-only token.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly apiTokens: ApiTokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    if (isApiToken(token)) {
      request.user = await this.withApiToken(token, context);
      return true;
    }

    const user = await this.auth.identify(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    request.user = user;
    return true;
  }

  private async withApiToken(token: string, context: ExecutionContext): Promise<AuthUser> {
    const http = context.switchToHttp();
    const identity = await this.apiTokens.identify(token);
    if (!identity) {
      throw new UnauthorizedException('Unknown or revoked API token');
    }

    // Counted before the checks below, so refused requests use up the allowance too.
    const retryAfter = await this.apiTokens.throttle(identity.tokenId);
    if (retryAfter > 0) {
      http.getResponse<Response>().setHeader('Retry-After', retryAfter);
      throw new HttpException('Too many requests with this API token', HttpStatus.TOO_MANY_REQUESTS);
    }

    // Closed unless marked open: a route nobody thought about takes a login only.
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_API_TOKEN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed) {
      throw new ForbiddenException('An API token cannot do this. Sign in instead.');
    }
    if (identity.readOnly && !READ_METHODS.has(http.getRequest<AuthenticatedRequest>().method)) {
      throw new ForbiddenException('This API token is read-only');
    }
    return { id: identity.userId, email: identity.email };
  }
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}
