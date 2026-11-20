import { Body, Controller, Get, Post, StreamableFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { ImportOptionsDto } from './dto/import-options.dto';
import { ExportService } from './export.service';
import { ImportResult, ImportService } from './import.service';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@AllowApiToken()
@Controller()
export class TransferController {
  constructor(
    private readonly exporter: ExportService,
    private readonly importer: ImportService,
  ) {}

  /** Downloads every note as a zip of Markdown files, with notebooks as folders. */
  @Get('export')
  async exportAll(@CurrentUser() user: AuthUser): Promise<StreamableFile> {
    const zip = await this.exporter.exportAll(user.id);
    const date = new Date().toISOString().slice(0, 10);
    return new StreamableFile(zip, {
      type: 'application/zip',
      disposition: `attachment; filename="notes-export-${date}.zip"`,
    });
  }

  /** Imports Markdown, text or Evernote files, or zips of Markdown such as a Notion export, sent as `files`. */
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          maxItems: 50,
          items: { type: 'string', format: 'binary' },
          description:
            'Up to 50 files: .md, .markdown, .txt, Evernote .enex, or a .zip of Markdown (a Notion export too). Folders in a zip become notebooks.',
        },
        skipExisting: {
          type: 'boolean',
          default: true,
          description: 'Leave out notes whose title, notebook and text the account already has.',
        },
      },
    },
  })
  @Post('import')
  @UseInterceptors(FilesInterceptor('files', 50, { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  import(
    @CurrentUser() user: AuthUser,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() options: ImportOptionsDto,
  ): Promise<ImportResult> {
    return this.importer.import(user.id, files ?? [], { skipExisting: options.skipExisting ?? true });
  }
}
