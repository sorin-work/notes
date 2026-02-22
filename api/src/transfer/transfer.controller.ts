import { Controller, Get, Post, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ExportService } from './export.service';
import { ImportResult, ImportService } from './import.service';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@Controller()
export class TransferController {
  constructor(
    private readonly exporter: ExportService,
    private readonly importer: ImportService,
  ) {}

  @Get('export')
  async exportAll(@CurrentUser() user: AuthUser): Promise<StreamableFile> {
    const zip = await this.exporter.exportAll(user.id);
    const date = new Date().toISOString().slice(0, 10);
    return new StreamableFile(zip, {
      type: 'application/zip',
      disposition: `attachment; filename="notes-export-${date}.zip"`,
    });
  }

  @Post('import')
  @UseInterceptors(FilesInterceptor('files', 50, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  import(
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<ImportResult> {
    return this.importer.import(user.id, files ?? []);
  }
}
