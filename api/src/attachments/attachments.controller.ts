import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { AttachmentsService, AttachmentView } from './attachments.service';

/**
 * Multer's own cap, which ATTACHMENT_MAX_MB cannot go above. The limit that
 * is set is checked by the service, with a clear message.
 */
export const UPLOAD_CEILING_BYTES = 50 * 1024 * 1024;

@AllowApiToken()
@Controller('notes/:noteId/attachments')
export class NoteAttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** The files of a note, each with an address that works without a login for a few minutes. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Param('noteId', ParseUUIDPipe) noteId: string): Promise<AttachmentView[]> {
    return this.attachments.list(user.id, noteId);
  }

  /** Attaches a file, sent as `file`: a PNG, JPEG, GIF or WebP image, a PDF, or plain text. */
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary', description: 'The type is read from the bytes.' } },
    },
  })
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_CEILING_BYTES, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<AttachmentView> {
    if (!file) throw new BadRequestException('Choose a file to attach');
    return this.attachments.upload(user.id, noteId, file);
  }
}

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  /** Removes an attachment and its file. A note that still shows it gets a broken image. */
  @AllowApiToken()
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.attachments.remove(user.id, id);
  }

  /**
   * The file itself, at the signed address a list or a shared note gave out.
   * No login: the signature is the permission, and it runs out in minutes.
   *
   * Images are shown in the page; PDF and text are always downloads. Every
   * answer says nosniff and carries a sandboxing policy, so whatever a file
   * holds, the browser does not run it as part of the app.
   */
  @Public()
  @Get(':id')
  async file(
    @Param('id') id: string,
    @Query('expires') expires: string | undefined,
    @Query('signature') signature: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const served = await this.attachments.serve(id, expires, signature);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Cache-Control', 'private, max-age=300');
    const encoded = encodeURIComponent(served.fileName);
    return new StreamableFile(served.stream, {
      type: served.contentType,
      length: served.size,
      disposition: `${served.inline ? 'inline' : 'attachment'}; filename="${encoded}"; filename*=UTF-8''${encoded}`,
    });
  }
}
