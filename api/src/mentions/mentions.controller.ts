import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { PaginationQuery } from '../common/pagination';
import { MentionPage, MentionsService } from './mentions.service';

@Controller('notes/:noteId/mentions')
export class MentionsController {
  constructor(private readonly mentions: MentionsService) {}

  /** Notes that mention this note's title without linking to it. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query() query: PaginationQuery,
  ): Promise<MentionPage> {
    return this.mentions.list(user.id, noteId, query);
  }

  /** Turns the first such mention in the note `sourceId` into a [[link]]. */
  @Post(':sourceId/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  link(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
  ): Promise<void> {
    return this.mentions.link(user.id, noteId, sourceId);
  }
}
