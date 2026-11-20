import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { LinksModule } from '../links/links.module';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { TagsModule } from '../tags/tags.module';
import { BackupService } from './backup.service';
import { DownloadTickets } from './download-tickets';
import { ExportService } from './export.service';
import { ImportService } from './import.service';
import { TransferController } from './transfer.controller';

@Module({
  imports: [TagsModule, LinksModule, AttachmentsModule, NotebooksModule],
  controllers: [TransferController],
  providers: [ExportService, ImportService, BackupService, DownloadTickets],
  exports: [ExportService],
})
export class TransferModule {}
