import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../common/current-user.decorator';
import { IS_PUBLIC } from '../common/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { TokenPayload } from './auth.service';

/**
 * Registered globally: every route needs a valid bearer token unless it is
 * marked with @Public().
 *
 * A token is only good while its version matches the account's
 * tokenVersion, which is how a password change or "sign out everywhere"
 * ends sessions before their token expires. That costs one primary-key
 * lookup of two columns on every authenticated request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
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

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { email: true, tokenVersion: true },
    });
    // No user: the account was deleted after the token was issued.
    if (!user || user.tokenVersion !== (payload.ver ?? 0)) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    request.user = { id: payload.sub, email: user.email };
    return true;
  }
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
  return value;
}
