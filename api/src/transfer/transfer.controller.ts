import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
  Req,
  StreamableFile,
  UnsupportedMediaTypeException,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { Readable } from 'node:stream';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { BackupService, RestoreResult } from './backup.service';
import { ImportOptionsDto } from './dto/import-options.dto';
import { DownloadTickets } from './download-tickets';
import { ExportService } from './export.service';
import { ImportResult, ImportService } from './import.service';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

@AllowApiToken()
@Controller()
export class TransferController {
  constructor(
    private readonly exporter: ExportService,
    private readonly importer: ImportService,
    private readonly backups: BackupService,
    private readonly tickets: DownloadTickets,
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

  /**
   * Downloads a full backup as JSON: every note with its version history and
   * revision, the trash, notebooks, tags and a record of the share links.
   * The schema is in the README.
   */
  @Get('export/backup')
  exportBackup(@CurrentUser() user: AuthUser): StreamableFile {
    return this.backupFile(user.id);
  }

  /**
   * A link to the same backup that works once, within a minute, without a
   * login, so a browser can follow it and save the file as it streams in.
   */
  @Post('export/backup/link')
  backupLink(@CurrentUser() user: AuthUser): { url: string } {
    return { url: `/api/export/backup/download?ticket=${encodeURIComponent(this.tickets.issue(user.id))}` };
  }

  /** The backup behind a link from POST /export/backup/link. */
  @Public()
  @Get('export/backup/download')
  downloadBackup(@Query('ticket') ticket: string | undefined): StreamableFile {
    const userId = this.tickets.redeem(ticket);
    if (!userId) throw new NotFoundException('This download link has run out or was used already');
    return this.backupFile(userId);
  }

  /**
   * Restores a JSON backup into an account that is still empty. The file is
   * the body of the request itself, as `application/octet-stream`, and is
   * read while it comes in, so a backup of any size can be restored.
   */
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary', description: 'A backup from GET /export/backup.' } })
  @Post('import/backup')
  restoreBackup(@CurrentUser() user: AuthUser, @Req() request: Request): Promise<RestoreResult> {
    if (!request.is('application/octet-stream')) {
      throw new UnsupportedMediaTypeException('Send the backup file itself as application/octet-stream');
    }
    if (request.readableEnded) throw new BadRequestException('Choose a backup file to restore');
    return this.backups.restore(user.id, request);
  }

  private backupFile(userId: string): StreamableFile {
    const date = new Date().toISOString().slice(0, 10);
    return new StreamableFile(Readable.from(this.backups.write(userId)), {
      type: 'application/json',
      disposition: `attachment; filename="notes-backup-${date}.json"`,
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
