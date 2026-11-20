import type { Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SESSION_ONLY } from '../common/session-only.decorator';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokensService } from './api-tokens.service';
import { AuthController } from './auth.controller';

describe('ApiTokensController', () => {
  let controller: ApiTokensController;
  const tokens = { list: jest.fn(), create: jest.fn(), revoke: jest.fn() };
  const user = { id: 'user-1', email: 'ada@example.com' };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [ApiTokensController],
      providers: [{ provide: ApiTokensService, useValue: tokens }],
    }).compile();
    controller = moduleRef.get(ApiTokensController);
  });

  it('lists, creates and revokes for the current user', async () => {
    tokens.create.mockResolvedValue({ id: 't1', token: 'nt_secret' });
    await controller.list(user);
    expect(tokens.list).toHaveBeenCalledWith('user-1');
    await expect(controller.create(user, { name: 'script' })).resolves.toEqual({ id: 't1', token: 'nt_secret' });
    expect(tokens.create).toHaveBeenCalledWith('user-1', { name: 'script' });
    await controller.revoke(user, 't1');
    expect(tokens.revoke).toHaveBeenCalledWith('user-1', 't1');
  });
});

describe('routes that need a login', () => {
  const reflector = new Reflector();
  const sessionOnly = (controller: Type<unknown>, handler: (...args: never[]) => unknown) =>
    reflector.getAllAndOverride<boolean>(SESSION_ONLY, [handler, controller]);

  it('covers every route for managing tokens', () => {
    const { prototype } = ApiTokensController;
    for (const handler of [prototype.list, prototype.create, prototype.revoke]) {
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
