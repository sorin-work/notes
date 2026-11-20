import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../common/current-user.decorator';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
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
  let prisma: PrismaMock;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ email: 'ada@example.com', tokenVersion: 0 });
    guard = new JwtAuthGuard(jwt, reflector, asPrismaService(prisma));
  });

  it('lets public routes through without a token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    await expect(guard.canActivate(contextFor({ headers: {} }))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
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

  it('puts the token owner on the request, with the email the account has now', async () => {
    const token = jwt.sign({ sub: 'user-1', ver: 0 });
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: `Bearer ${token}` } };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1', email: 'ada@example.com' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { email: true, tokenVersion: true },
    });
  });

  it('rejects a token from before the token version was bumped', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'ada@example.com', tokenVersion: 3 });
    const stale = { headers: { authorization: `Bearer ${jwt.sign({ sub: 'user-1', ver: 2 })}` } };
    await expect(guard.canActivate(contextFor(stale))).rejects.toThrow('Invalid or expired token');
    const current = { headers: { authorization: `Bearer ${jwt.sign({ sub: 'user-1', ver: 3 })}` } };
    await expect(guard.canActivate(contextFor(current))).resolves.toBe(true);
  });

  it('treats a token without a version as version 0', async () => {
    const old = { headers: { authorization: `Bearer ${jwt.sign({ sub: 'user-1', email: 'ada@example.com' })}` } };
    await expect(guard.canActivate(contextFor(old))).resolves.toBe(true);
    prisma.user.findUnique.mockResolvedValue({ email: 'ada@example.com', tokenVersion: 1 });
    await expect(guard.canActivate(contextFor(old))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token whose account was deleted', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const request = { headers: { authorization: `Bearer ${jwt.sign({ sub: 'user-1', ver: 0 })}` } };
    await expect(guard.canActivate(contextFor(request))).rejects.toThrow('Invalid or expired token');
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
