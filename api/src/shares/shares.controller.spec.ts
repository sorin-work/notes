import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AuthService } from '../auth/auth.service';
import { IS_PUBLIC } from '../common/public.decorator';
import { PublicSharesController, SharesController } from './shares.controller';
import { SharesService } from './shares.service';

describe('SharesController', () => {
  const service = { get: jest.fn(), create: jest.fn(), update: jest.fn(), revoke: jest.fn(), view: jest.fn() };
  const user = { id: 'user-1', email: 'ada@example.com' };

  beforeEach(() => jest.resetAllMocks());

  it('wraps the current share in an object so "not shared" is not an empty body', async () => {
    service.get.mockResolvedValue(null);
    const controller = new SharesController(service as unknown as SharesService);
    await expect(controller.get(user, 'n1')).resolves.toEqual({ share: null });
    await controller.create(user, 'n1', {});
    await controller.update(user, 'n1', { password: null });
    await controller.revoke(user, 'n1');
    expect(service.create).toHaveBeenCalledWith('user-1', 'n1', {});
    expect(service.update).toHaveBeenCalledWith('user-1', 'n1', { password: null });
    expect(service.revoke).toHaveBeenCalledWith('user-1', 'n1');
  });
});

describe('PublicSharesController', () => {
  const service = { view: jest.fn() };
  const auth = { identify: jest.fn() };
  const response = { setHeader: jest.fn() };
  const sent = response as unknown as Response;
  let controller: PublicSharesController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new PublicSharesController(service as unknown as SharesService, auth as unknown as AuthService);
  });

  it('serves shared notes without a login, and tells nobody to keep a copy', async () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC, PublicSharesController.prototype.view)).toBe(true);
    expect(reflector.get(IS_PUBLIC, PublicSharesController.prototype.unlock)).toBe(true);

    await controller.view('tok', undefined, sent);

    expect(service.view).toHaveBeenCalledWith('tok', { userId: undefined });
    expect(auth.identify).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('says so before the lookup, so that "gone" and "password needed" are not kept either', async () => {
    service.view.mockRejectedValue(new Error('gone'));
    await expect(controller.unlock('tok', { password: 'guess' }, undefined, sent)).rejects.toThrow('gone');
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('passes on who is asking when a login comes with the request, so the owner is not counted', async () => {
    auth.identify.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    await controller.view('tok', 'Bearer login-token', sent);
    expect(auth.identify).toHaveBeenCalledWith('login-token');
    expect(service.view).toHaveBeenCalledWith('tok', { userId: 'user-1' });
  });

  it('treats a login that is no good as no login', async () => {
    auth.identify.mockResolvedValue(null);
    await controller.unlock('tok', { password: 'open sesame' }, 'Bearer stale', sent);
    expect(service.view).toHaveBeenCalledWith('tok', { userId: undefined, password: 'open sesame' });
  });
});
