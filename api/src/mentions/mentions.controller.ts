import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { PaginationQuery } from '../common/pagination';
import { LinkMentionDto } from './dto/mention.dto';
import { MentionPage, MentionsService } from './mentions.service';

@AllowApiToken()
@Controller('notes/:noteId/mentions')
export class MentionsController {
  constructor(private readonly mentions: MentionsService) {}

  /** Notes that mention this note's title without linking to it, each with the mention that can be linked. */
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query() query: PaginationQuery,
  ): Promise<MentionPage> {
    return this.mentions.list(user.id, noteId, query);
  }

  /** Puts [[ ]] around one mention in the note `sourceId`. 409 when that note has changed since the list was made. */
  @Post(':sourceId/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  link(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Body() dto: LinkMentionDto,
  ): Promise<void> {
    return this.mentions.link(user.id, noteId, sourceId, dto);
  }
}
