import { Controller, Get, StreamableFile } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ExportService } from './export.service';

@Controller()
export class TransferController {
  constructor(private readonly exporter: ExportService) {}

  @Get('export')
  async exportAll(@CurrentUser() user: AuthUser): Promise<StreamableFile> {
    const zip = await this.exporter.exportAll(user.id);
    const date = new Date().toISOString().slice(0, 10);
    return new StreamableFile(zip, {
      type: 'application/zip',
      disposition: `attachment; filename="notes-export-${date}.zip"`,
    });
  }
}
