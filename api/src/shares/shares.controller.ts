import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { bearerToken } from '../auth/jwt-auth.guard';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { ShareOptionsDto, UnlockShareDto } from './dto/share.dto';
import { PublicThrottlerGuard } from './public-throttler.guard';
import { TooManyWrongPasswords } from './share-password-attempts';
import { SharedNote, SharedNotebook, SharesService, ShareView } from './shares.service';

@AllowApiToken()
@Controller('notes/:noteId/share')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  /** Whether the note is shared, and the link with its options if it is. */
  @Get()
  async get(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<{ share: ShareView | null }> {
    return { share: await this.shares.get(user.id, { noteId }) };
  }

  /** Shares the note. Sharing it again answers with the same link. An expiry and a password can be set on the way. */
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() options: ShareOptionsDto,
  ): Promise<ShareView> {
    return this.shares.create(user.id, { noteId }, options);
  }

  /** Changes when the link runs out and whether it asks for a password. null takes either away. */
  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() options: ShareOptionsDto,
  ): Promise<ShareView> {
    return this.shares.update(user.id, { noteId }, options);
  }

  /** Stops sharing. The link stops working. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AuthUser, @Param('noteId', ParseUUIDPipe) noteId: string): Promise<void> {
    return this.shares.revoke(user.id, { noteId });
  }
}

/** The same four routes for a notebook, which is shared with everything in it. */
@AllowApiToken()
@Controller('notebooks/:notebookId/share')
export class NotebookSharesController {
  constructor(private readonly shares: SharesService) {}

  /** Whether the notebook is shared, and the link with its options if it is. */
  @Get()
  async get(
    @CurrentUser() user: AuthUser,
    @Param('notebookId', ParseUUIDPipe) notebookId: string,
  ): Promise<{ share: ShareView | null }> {
    return { share: await this.shares.get(user.id, { notebookId }) };
  }

  /** Shares the notebook, its notes and the notebooks inside it, with one link. Sharing it again answers with the same link. */
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentUser() user: AuthUser,
    @Param('notebookId', ParseUUIDPipe) notebookId: string,
    @Body() options: ShareOptionsDto,
  ): Promise<ShareView> {
    return this.shares.create(user.id, { notebookId }, options);
  }

  /** Changes when the link runs out and whether it asks for a password. null takes either away. */
  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Param('notebookId', ParseUUIDPipe) notebookId: string,
    @Body() options: ShareOptionsDto,
  ): Promise<ShareView> {
    return this.shares.update(user.id, { notebookId }, options);
  }

  /** Stops sharing the notebook. The link stops working for all its notes. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AuthUser, @Param('notebookId', ParseUUIDPipe) notebookId: string): Promise<void> {
    return this.shares.revoke(user.id, { notebookId });
  }
}

/**
 * What readers of a share link use. No login is needed, but a login that
 * is sent along is looked at, to leave the owner's own visits out of the
 * view count.
 *
 * Nothing here may be kept by a browser or a proxy: a link that is revoked,
 * runs out or gets a password has to stop working at once, and a note
 * behind a password must not sit in a cache. So every answer, the errors
 * too, goes out with "Cache-Control: no-store". SharesModule sets it in a
 * middleware, ahead of the guards.
 */
@Controller('public/notes')
export class PublicSharesController {
  constructor(
    private readonly shares: SharesService,
    private readonly auth: AuthService,
  ) {}

  /**
   * What a share link shows: a note, or the list of notes of a shared notebook. `403` with `passwordRequired` when the link asks for a password.
   *
   * Throttled per client, with the roomy allowance for reading. A reader
   * who gave the password before sends the `access` value they got for it
   * in the X-Share-Access header.
   */
  @Public()
  @UseGuards(PublicThrottlerGuard)
  @Get(':token')
  async view(
    @Param('token') token: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-share-access') access: string | undefined,
  ): Promise<SharedNote | SharedNotebook> {
    return this.shares.view(token, { userId: await this.viewerId(authorization), access });
  }

  /**
   * The same, for a link with a password. The password goes in the body, never in the address.
   *
   * The answer has an `access` value to send with later requests instead of
   * the password. Throttled per client with the strict allowance. The link
   * itself also takes only so many wrong passwords a minute, whoever sends
   * them.
   */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async unlock(
    @Param('token') token: string,
    @Body() dto: UnlockShareDto,
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SharedNote | SharedNotebook> {
    try {
      return await this.shares.view(token, { userId: await this.viewerId(authorization), password: dto.password });
    } catch (error) {
      if (error instanceof TooManyWrongPasswords) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  /** One note of a shared notebook. `404` for a note that is not in it, or not any more. */
  @Public()
  @UseGuards(PublicThrottlerGuard)
  @Get(':token/:noteId')
  async viewNote(
    @Param('token') token: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('x-share-access') access: string | undefined,
  ): Promise<SharedNote> {
    return this.shares.viewNote(token, noteId, { userId: await this.viewerId(authorization), access });
  }

  /** The account behind a login token that came with the request. Anything else counts as a stranger. */
  private async viewerId(authorization: string | undefined): Promise<string | undefined> {
    const token = bearerToken(authorization);
    return token ? (await this.auth.identify(token))?.id : undefined;
  }
}
