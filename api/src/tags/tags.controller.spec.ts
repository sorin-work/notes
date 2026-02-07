import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

describe('TagsController', () => {
  const service = { list: jest.fn(), rename: jest.fn(), remove: jest.fn() };
  const controller = new TagsController(service as unknown as TagsService);
  const user = { id: 'user-1', email: 'ada@example.com' };

  it('lists, renames and removes the current user’s tags', async () => {
    await controller.list(user);
    await controller.rename(user, 't1', { name: 'books' });
    await controller.remove(user, 't1');
    expect(service.list).toHaveBeenCalledWith('user-1');
    expect(service.rename).toHaveBeenCalledWith('user-1', 't1', { name: 'books' });
    expect(service.remove).toHaveBeenCalledWith('user-1', 't1');
  });
});
