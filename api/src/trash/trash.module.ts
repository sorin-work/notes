import { Module } from '@nestjs/common';
import { TrashPurgeService } from './trash-purge.service';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  controllers: [TrashController],
  providers: [TrashService, TrashPurgeService],
})
export class TrashModule {}
