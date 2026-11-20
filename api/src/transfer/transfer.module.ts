import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { TagsModule } from '../tags/tags.module';
import { ExportService } from './export.service';
import { ImportService } from './import.service';
import { TransferController } from './transfer.controller';

@Module({
  imports: [TagsModule, LinksModule, NotebooksModule],
  controllers: [TransferController],
  providers: [ExportService, ImportService],
  exports: [ExportService],
})
export class TransferModule {}
