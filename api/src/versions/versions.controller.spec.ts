import { VersionsController } from './versions.controller';
import { VersionsService } from './versions.service';

describe('VersionsController', () => {
  const service = { list: jest.fn(), get: jest.fn(), restore: jest.fn() };
  const controller = new VersionsController(service as unknown as VersionsService);
  const user = { id: 'user-1', email: 'ada@example.com' };

  it('scopes versions to the note and the current user', async () => {
    await controller.list(user, 'n1');
    await controller.get(user, 'n1', 'v1');
    await controller.restore(user, 'n1', 'v1');
    expect(service.list).toHaveBeenCalledWith('user-1', 'n1');
    expect(service.get).toHaveBeenCalledWith('user-1', 'n1', 'v1');
    expect(service.restore).toHaveBeenCalledWith('user-1', 'n1', 'v1');
  });
});
