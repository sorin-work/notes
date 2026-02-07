import { NotebooksController } from './notebooks.controller';
import { NotebooksService } from './notebooks.service';

describe('NotebooksController', () => {
  const service = { list: jest.fn(), create: jest.fn(), update: jest.fn(), remove: jest.fn() };
  const controller = new NotebooksController(service as unknown as NotebooksService);
  const user = { id: 'user-1', email: 'ada@example.com' };

  beforeEach(() => jest.resetAllMocks());

  it('passes the current user to the service', async () => {
    service.remove.mockResolvedValue({ trashedNotes: 2 });
    await controller.list(user);
    await controller.create(user, { name: 'Work' });
    await controller.update(user, 'nb', { name: 'Job' });
    await expect(controller.remove(user, 'nb')).resolves.toEqual({ trashedNotes: 2 });
    expect(service.list).toHaveBeenCalledWith('user-1');
    expect(service.create).toHaveBeenCalledWith('user-1', { name: 'Work' });
    expect(service.update).toHaveBeenCalledWith('user-1', 'nb', { name: 'Job' });
    expect(service.remove).toHaveBeenCalledWith('user-1', 'nb');
  });
});
