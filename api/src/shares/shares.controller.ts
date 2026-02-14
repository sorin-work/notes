import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { SharedNote, SharesService, ShareView } from './shares.service';

@Controller('notes/:noteId/share')
export class SharesController {
  constructor(private readonly shares: SharesService) {}

  @Get()
  async get(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
  ): Promise<{ share: ShareView | null }> {
    return { share: await this.shares.get(user.id, noteId) };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  create(@CurrentUser() user: AuthUser, @Param('noteId', ParseUUIDPipe) noteId: string): Promise<ShareView> {
    return this.shares.create(user.id, noteId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@CurrentUser() user: AuthUser, @Param('noteId', ParseUUIDPipe) noteId: string): Promise<void> {
    return this.shares.revoke(user.id, noteId);
  }
}

@Controller('public/notes')
export class PublicSharesController {
  constructor(private readonly shares: SharesService) {}

  @Public()
  @Get(':token')
  view(@Param('token') token: string): Promise<SharedNote> {
    return this.shares.view(token);
  }
}
