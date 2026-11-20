import type { AttachmentsService } from '../attachments/attachments.service';
import { TrashPurgeService } from './trash-purge.service';
import { TrashService } from './trash.service';

describe('TrashPurgeService', () => {
  afterEach(() => jest.useRealTimers());
  const files = () => ({ sweep: jest.fn().mockResolvedValue(0) });

  it('purges on start-up and then every hour', async () => {
    jest.useFakeTimers();
    const trash = { purgeExpired: jest.fn().mockResolvedValue(0) };
    const attachments = files();
    const purger = new TrashPurgeService(
      trash as unknown as TrashService,
      attachments as unknown as AttachmentsService,
    );

    purger.onApplicationBootstrap();
    expect(trash.purgeExpired).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(0);
    // Every run sweeps the files that have no row, the one on start-up too.
    expect(attachments.sweep).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(trash.purgeExpired).toHaveBeenCalledTimes(2);

    purger.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(trash.purgeExpired).toHaveBeenCalledTimes(2);
  });

  it('logs failures instead of crashing', async () => {
    const trash = { purgeExpired: jest.fn().mockRejectedValue(new Error('db down')) };
    const attachments = { sweep: jest.fn().mockRejectedValue(new Error('disk gone')) };
    const purger = new TrashPurgeService(
      trash as unknown as TrashService,
      attachments as unknown as AttachmentsService,
    );
    const log = jest.spyOn(purger['logger'], 'error').mockImplementation(() => undefined);
    await purger.run();
    expect(log).toHaveBeenCalledWith('Purging the trash failed: db down');
    expect(log).toHaveBeenCalledWith('Sweeping the attachment files failed: disk gone');
  });
});
