import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { TransferController } from './transfer.controller';

@Module({
  controllers: [TransferController],
  providers: [ExportService],
  exports: [ExportService],
})
export class TransferModule {}
