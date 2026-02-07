import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

describe('TrashController', () => {
  const service = { list: jest.fn(), restore: jest.fn(), deletePermanently: jest.fn(), empty: jest.fn() };
  const controller = new TrashController(service as unknown as TrashService);
  const user = { id: 'user-1', email: 'ada@example.com' };

  it('passes the current user to every action', async () => {
    service.empty.mockResolvedValue({ deleted: 2 });
    await controller.list(user);
    await controller.restore(user, 'n1');
    await controller.deletePermanently(user, 'n2');
    await expect(controller.empty(user)).resolves.toEqual({ deleted: 2 });
    expect(service.list).toHaveBeenCalledWith('user-1');
    expect(service.restore).toHaveBeenCalledWith('user-1', 'n1');
    expect(service.deletePermanently).toHaveBeenCalledWith('user-1', 'n2');
    expect(service.empty).toHaveBeenCalledWith('user-1');
  });
});
