import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../common/current-user.decorator';
import { bearerToken, JwtAuthGuard } from './jwt-auth.guard';

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'guard-test-secret-that-is-long-enough-01234' });
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(jwt, reflector);
  });

  it('lets public routes through without a token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
  });

  it('rejects requests without a token', async () => {
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow('Missing bearer token');
  });

  it('rejects tokens signed with another secret', async () => {
    const forged = new JwtService({ secret: 'some-other-secret-that-is-long-enough-xx' }).sign({
      sub: 'u',
      email: 'e',
    });
    const request = { headers: { authorization: `Bearer ${forged}` } };
    await expect(guard.canActivate(contextFor(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects expired tokens', async () => {
    const expired = jwt.sign({ sub: 'u', email: 'e', exp: Math.floor(Date.now() / 1000) - 60 });
    const request = { headers: { authorization: `Bearer ${expired}` } };
    await expect(guard.canActivate(contextFor(request))).rejects.toThrow('Invalid or expired token');
  });

  it('puts the token owner on the request', async () => {
    const token = jwt.sign({ sub: 'user-1', email: 'ada@example.com' });
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'ada@example.com' });
  });
});

describe('bearerToken', () => {
  it('reads the token from a Bearer header in any case', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
  });

  it('ignores other schemes and empty values', () => {
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
  });
});
