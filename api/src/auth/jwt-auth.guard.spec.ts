import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../common/current-user.decorator';
import { IS_PUBLIC } from '../common/public.decorator';
import { SESSION_ONLY } from '../common/session-only.decorator';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import type { ApiTokensService } from './api-tokens.service';
import { bearerToken, JwtAuthGuard } from './jwt-auth.guard';

const response = { setHeader: jest.fn() };

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: 'guard-test-secret-that-is-long-enough-01234' });
  let reflector: Reflector;
  let prisma: PrismaMock;
  let apiTokens: { identify: jest.Mock; throttle: jest.Mock };
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ email: 'ada@example.com', tokenVersion: 0 });
    apiTokens = { identify: jest.fn(), throttle: jest.fn().mockResolvedValue(0) };
    response.setHeader.mockReset();
    guard = new JwtAuthGuard(jwt, reflector, asPrismaService(prisma), apiTokens as unknown as ApiTokensService);
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

  describe('with an API token', () => {
    const identity = { tokenId: 'token-1', userId: 'user-1', email: 'ada@example.com', readOnly: false };
    const withToken = (method: string): Partial<AuthenticatedRequest> => ({
      method,
      headers: { authorization: 'Bearer nt_secret' },
    });
    const markedAs = (key: string) =>
      jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((asked: unknown) => asked === key);

    it('looks the token up instead of reading it as a JWT', async () => {
      apiTokens.identify.mockResolvedValue(identity);
      const request = withToken('POST');
      await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
      expect(apiTokens.identify).toHaveBeenCalledWith('nt_secret');
      expect(request.user).toEqual({ id: 'user-1', email: 'ada@example.com' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a token that does not exist', async () => {
      apiTokens.identify.mockResolvedValue(null);
      await expect(guard.canActivate(contextFor(withToken('GET')))).rejects.toBeInstanceOf(UnauthorizedException);
      expect(apiTokens.throttle).not.toHaveBeenCalled();
    });

    it('lets a read-only token read and nothing else', async () => {
      apiTokens.identify.mockResolvedValue({ ...identity, readOnly: true });
      await expect(guard.canActivate(contextFor(withToken('GET')))).resolves.toBe(true);
      await expect(guard.canActivate(contextFor(withToken('HEAD')))).resolves.toBe(true);
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        await expect(guard.canActivate(contextFor(withToken(method)))).rejects.toThrow('This API token is read-only');
      }
    });

    it('keeps every token, read-only or not, out of routes that need a login', async () => {
      markedAs(SESSION_ONLY);
      apiTokens.identify.mockResolvedValue(identity);
      await expect(guard.canActivate(contextFor(withToken('GET')))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(guard.canActivate(contextFor(withToken('DELETE')))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers 429 with Retry-After once the token is over its allowance', async () => {
      apiTokens.identify.mockResolvedValue(identity);
      apiTokens.throttle.mockResolvedValue(42);
      const refused = guard.canActivate(contextFor(withToken('GET')));
      await expect(refused).rejects.toMatchObject({ status: 429 });
      expect(apiTokens.throttle).toHaveBeenCalledWith('token-1');
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 42);
    });

    it('is not looked at on public routes', async () => {
      markedAs(IS_PUBLIC);
      await expect(guard.canActivate(contextFor(withToken('POST')))).resolves.toBe(true);
      expect(apiTokens.identify).not.toHaveBeenCalled();
    });
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
