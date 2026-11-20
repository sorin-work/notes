import { ForbiddenException, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { SESSION_ONLY } from '../common/session-only.decorator';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokensService } from './api-tokens.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('ApiTokensController', () => {
  let controller: ApiTokensController;
  const tokens = { list: jest.fn(), create: jest.fn(), revoke: jest.fn(), revokeAll: jest.fn() };
  const auth = { assertPassword: jest.fn() };
  const user = { id: 'user-1', email: 'ada@example.com' };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }])],
      controllers: [ApiTokensController],
      providers: [
        { provide: ApiTokensService, useValue: tokens },
        { provide: AuthService, useValue: auth },
      ],
    }).compile();
    controller = moduleRef.get(ApiTokensController);
  });

  it('lists and revokes for the current user, one token or all of them', async () => {
    tokens.revokeAll.mockResolvedValue({ revoked: 2 });
    await controller.list(user);
    expect(tokens.list).toHaveBeenCalledWith('user-1');
    await controller.revoke(user, 't1');
    expect(tokens.revoke).toHaveBeenCalledWith('user-1', 't1');
    await expect(controller.revokeAll(user)).resolves.toEqual({ revoked: 2 });
    expect(tokens.revokeAll).toHaveBeenCalledWith('user-1');
  });

  it('checks the password before it makes a token', async () => {
    tokens.create.mockResolvedValue({ id: 't1', token: 'nt_secret' });
    const dto = { name: 'script', currentPassword: 'correct-horse' };

    await expect(controller.create(user, dto)).resolves.toEqual({ id: 't1', token: 'nt_secret' });

    expect(auth.assertPassword).toHaveBeenCalledWith('user-1', 'correct-horse');
    expect(tokens.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('makes no token when the password is wrong', async () => {
    auth.assertPassword.mockRejectedValue(new ForbiddenException('Current password is incorrect'));
    await expect(controller.create(user, { name: 'script', currentPassword: 'guess' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tokens.create).not.toHaveBeenCalled();
  });
});

describe('routes that need a login', () => {
  const reflector = new Reflector();
  const sessionOnly = (controller: Type<unknown>, handler: (...args: never[]) => unknown) =>
    reflector.getAllAndOverride<boolean>(SESSION_ONLY, [handler, controller]);

  it('covers every route for managing tokens', () => {
    const { prototype } = ApiTokensController;
    for (const handler of [prototype.list, prototype.create, prototype.revoke, prototype.revokeAll]) {
      expect(sessionOnly(ApiTokensController, handler)).toBe(true);
    }
  });

  it('covers the account routes, and leaves "who am I" open to tokens', () => {
    const { prototype } = AuthController;
    for (const handler of [
      prototype.updateProfile,
      prototype.deleteAccount,
      prototype.changePassword,
      prototype.logoutEverywhere,
    ]) {
      expect(sessionOnly(AuthController, handler)).toBe(true);
    }
    expect(sessionOnly(AuthController, prototype.me)).toBe(false);
  });
});
