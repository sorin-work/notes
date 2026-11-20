import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { TrashPurgeService } from './trash-purge.service';
import { TrashController } from './trash.controller';
import { TrashService } from './trash.service';

@Module({
  imports: [AttachmentsModule],
  controllers: [TrashController],
  providers: [TrashService, TrashPurgeService],
})
export class TrashModule {}
