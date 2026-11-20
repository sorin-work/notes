import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AttachmentsService } from '../attachments/attachments.service';
import { TrashService } from './trash.service';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Empties expired notes out of every trash once an hour, and once on
 * start-up, with the files of their attachments. Each run then sweeps the
 * attachment folder for files that have no row any more.
 */
@Injectable()
export class TrashPurgeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TrashPurgeService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly trash: TrashService,
    private readonly attachments: AttachmentsService,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), HOUR_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const count = await this.trash.purgeExpired();
      if (count > 0) {
        this.logger.log(`Deleted ${count} note(s) that were in the trash past the retention period`);
      }
    } catch (error) {
      this.logger.error(`Purging the trash failed: ${(error as Error).message}`);
    }
    try {
      const swept = await this.attachments.sweep();
      if (swept > 0) this.logger.log(`Removed ${swept} attachment file(s) that had no row`);
    } catch (error) {
      this.logger.error(`Sweeping the attachment files failed: ${(error as Error).message}`);
    }
  }
}
