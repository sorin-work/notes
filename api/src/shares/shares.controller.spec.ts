import { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../common/public.decorator';
import { PublicSharesController, SharesController } from './shares.controller';
import { SharesService } from './shares.service';

describe('SharesController', () => {
  const service = { get: jest.fn(), create: jest.fn(), revoke: jest.fn(), view: jest.fn() };
  const user = { id: 'user-1', email: 'ada@example.com' };

  it('wraps the current share in an object so "not shared" is not an empty body', async () => {
    service.get.mockResolvedValue(null);
    const controller = new SharesController(service as unknown as SharesService);
    await expect(controller.get(user, 'n1')).resolves.toEqual({ share: null });
    await controller.create(user, 'n1');
    await controller.revoke(user, 'n1');
    expect(service.create).toHaveBeenCalledWith('user-1', 'n1');
    expect(service.revoke).toHaveBeenCalledWith('user-1', 'n1');
  });

  it('serves shared notes without a login', async () => {
    const controller = new PublicSharesController(service as unknown as SharesService);
    expect(new Reflector().get(IS_PUBLIC, PublicSharesController.prototype.view)).toBe(true);
    await controller.view('tok');
    expect(service.view).toHaveBeenCalledWith('tok');
  });
});
