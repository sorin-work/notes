import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { AuthService } from '../auth/auth.service';
import { IS_PUBLIC } from '../common/public.decorator';
import { noStore } from './no-store.middleware';
import { TooManyWrongPasswords } from './share-password-attempts';
import { NotebookSharesController, PublicSharesController, SharesController } from './shares.controller';
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
    expect(service.get).toHaveBeenCalledWith('user-1', { noteId: 'n1' });
    expect(service.create).toHaveBeenCalledWith('user-1', { noteId: 'n1' }, {});
    expect(service.update).toHaveBeenCalledWith('user-1', { noteId: 'n1' }, { password: null });
    expect(service.revoke).toHaveBeenCalledWith('user-1', { noteId: 'n1' });
  });

  it('does the same for a notebook', async () => {
    service.get.mockResolvedValue(null);
    const controller = new NotebookSharesController(service as unknown as SharesService);
    await expect(controller.get(user, 'nb1')).resolves.toEqual({ share: null });
    await controller.create(user, 'nb1', { password: 'open sesame' });
    await controller.update(user, 'nb1', { expiresAt: null });
    await controller.revoke(user, 'nb1');
    expect(service.get).toHaveBeenCalledWith('user-1', { notebookId: 'nb1' });
    expect(service.create).toHaveBeenCalledWith('user-1', { notebookId: 'nb1' }, { password: 'open sesame' });
    expect(service.update).toHaveBeenCalledWith('user-1', { notebookId: 'nb1' }, { expiresAt: null });
    expect(service.revoke).toHaveBeenCalledWith('user-1', { notebookId: 'nb1' });
  });
});

describe('PublicSharesController', () => {
  const service = { view: jest.fn(), viewNote: jest.fn() };
  const auth = { identify: jest.fn() };
  const response = { setHeader: jest.fn() };
  const sent = response as unknown as Response;
  let controller: PublicSharesController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new PublicSharesController(service as unknown as SharesService, auth as unknown as AuthService);
  });

  it('serves shared notes without a login', async () => {
    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC, PublicSharesController.prototype.view)).toBe(true);
    expect(reflector.get(IS_PUBLIC, PublicSharesController.prototype.unlock)).toBe(true);

    expect(reflector.get(IS_PUBLIC, PublicSharesController.prototype.viewNote)).toBe(true);

    await controller.view('tok', undefined, undefined);

    expect(service.view).toHaveBeenCalledWith('tok', { userId: undefined, access: undefined });
    expect(auth.identify).not.toHaveBeenCalled();
  });

  it('says how long to wait when the link has had its wrong passwords, and passes other refusals on as they are', async () => {
    service.view.mockRejectedValue(new TooManyWrongPasswords(42));
    await expect(controller.unlock('tok', { password: 'guess' }, undefined, sent)).rejects.toMatchObject({
      status: 429,
    });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '42');

    response.setHeader.mockClear();
    service.view.mockRejectedValue(new Error('gone'));
    await expect(controller.unlock('tok', { password: 'guess' }, undefined, sent)).rejects.toThrow('gone');
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('passes on who is asking when a login comes with the request, so the owner is not counted', async () => {
    auth.identify.mockResolvedValue({ id: 'user-1', email: 'ada@example.com' });
    await controller.view('tok', 'Bearer login-token', undefined);
    expect(auth.identify).toHaveBeenCalledWith('login-token');
    expect(service.view).toHaveBeenCalledWith('tok', { userId: 'user-1', access: undefined });
  });

  it('hands on the proof of an earlier password, for the link and for a note inside a notebook', async () => {
    await controller.view('tok', undefined, 'proof');
    expect(service.view).toHaveBeenCalledWith('tok', { userId: undefined, access: 'proof' });
    await controller.viewNote('tok', 'n1', undefined, 'proof');
    expect(service.viewNote).toHaveBeenCalledWith('tok', 'n1', { userId: undefined, access: 'proof' });
  });

  it('treats a login that is no good as no login', async () => {
    auth.identify.mockResolvedValue(null);
    await controller.unlock('tok', { password: 'open sesame' }, 'Bearer stale', sent);
    expect(service.view).toHaveBeenCalledWith('tok', { userId: undefined, password: 'open sesame' });
  });
});

describe('noStore', () => {
  it('marks the answer before anything else gets to refuse the request', () => {
    const response = { setHeader: jest.fn() };
    const next = jest.fn();
    noStore({} as never, response as unknown as Response, next);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledWith();
  });
});
