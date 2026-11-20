import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module';
import { TagsModule } from '../tags/tags.module';
import { BackupService } from './backup.service';
import { ExportService } from './export.service';
import { ImportService } from './import.service';
import { TransferController } from './transfer.controller';

@Module({
  imports: [TagsModule, LinksModule],
  controllers: [TransferController],
  providers: [ExportService, ImportService, BackupService],
  exports: [ExportService],
})
export class TransferModule {}
