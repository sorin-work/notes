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
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from '../auth/auth.service';
import { bearerToken } from '../auth/jwt-auth.guard';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { ShareOptionsDto, UnlockShareDto } from './dto/share.dto';
import { PublicThrottlerGuard } from './public-throttler.guard';
import { ShareLinkThrottlerGuard } from './share-link-throttler.guard';
import { SharedNote, SharesService, ShareView } from './shares.service';

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
    return { share: await this.shares.get(user.id, noteId) };
  }

  /** Shares the note. Sharing it again answers with the same link. An expiry and a password can be set on the way. */
  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() options: ShareOptionsDto,
  ): Promise<ShareView> {
    return this.shares.create(user.id, noteId, options);
  }

  /** Changes when the link runs out and whether it asks for a password. null takes either away. */
  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() options: ShareOptionsDto,
  ): Promise<ShareView> {
    return this.shares.update(user.id, noteId, options);
  }

  /** Stops sharing. The link stops working. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AuthUser, @Param('noteId', ParseUUIDPipe) noteId: string): Promise<void> {
    return this.shares.revoke(user.id, noteId);
  }
}

/**
 * What readers of a shared note use. No login is needed, but a login that
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
   * The read-only copy of a shared note. `403` with `passwordRequired` when the link asks for a password.
   *
   * Throttled per client, with the roomy allowance for reading.
   */
  @Public()
  @UseGuards(PublicThrottlerGuard)
  @Get(':token')
  async view(
    @Param('token') token: string,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SharedNote> {
    return this.shares.view(token, { userId: await this.viewerId(authorization) });
  }

  /**
   * The same note, for a link with a password. The password goes in the body, never in the address.
   *
   * Attempts are throttled twice with the strict allowance: per client, and
   * per link whoever is asking.
   */
  @Public()
  @UseGuards(ThrottlerGuard, ShareLinkThrottlerGuard)
  @Post(':token')
  @HttpCode(HttpStatus.OK)
  async unlock(
    @Param('token') token: string,
    @Body() dto: UnlockShareDto,
    @Headers('authorization') authorization: string | undefined,
  ): Promise<SharedNote> {
    return this.shares.view(token, { userId: await this.viewerId(authorization), password: dto.password });
  }

  /** The account behind a login token that came with the request. Anything else counts as a stranger. */
  private async viewerId(authorization: string | undefined): Promise<string | undefined> {
    const token = bearerToken(authorization);
    return token ? (await this.auth.identify(token))?.id : undefined;
  }
}
