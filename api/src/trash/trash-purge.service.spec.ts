import { TrashPurgeService } from './trash-purge.service';
import { TrashService } from './trash.service';

describe('TrashPurgeService', () => {
  afterEach(() => jest.useRealTimers());

  it('purges on start-up and then every hour', async () => {
    jest.useFakeTimers();
    const trash = { purgeExpired: jest.fn().mockResolvedValue(0) };
    const purger = new TrashPurgeService(trash as unknown as TrashService);

    purger.onApplicationBootstrap();
    expect(trash.purgeExpired).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(trash.purgeExpired).toHaveBeenCalledTimes(2);

    purger.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(trash.purgeExpired).toHaveBeenCalledTimes(2);
  });

  it('logs failures instead of crashing', async () => {
    const trash = { purgeExpired: jest.fn().mockRejectedValue(new Error('db down')) };
    const purger = new TrashPurgeService(trash as unknown as TrashService);
    const log = jest.spyOn(purger['logger'], 'error').mockImplementation(() => undefined);
    await purger.run();
    expect(log).toHaveBeenCalledWith('Purging the trash failed: db down');
  });
});
