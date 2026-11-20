import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AccessService } from '../access/access.service';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { PaginationQuery } from '../common/pagination';
import { LinkMentionDto } from './dto/mention.dto';
import { MentionPage, MentionsService } from './mentions.service';

@AllowApiToken()
@Controller('notes/:noteId/mentions')
export class MentionsController {
  constructor(
    private readonly mentions: MentionsService,
    private readonly access: AccessService,
  ) {}

  /** Notes that mention this note's title without linking to it, each with the mention that can be linked. */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Query() query: PaginationQuery,
  ): Promise<MentionPage> {
    // A member sees mentions only in the notes of the notebooks shared with them.
    const granted = await this.access.note(user.id, noteId, 'read');
    const visible = await this.access.visibleNotebookIds(user.id, granted.ownerId);
    return this.mentions.list(granted.ownerId, noteId, query, visible ? [...visible] : undefined);
  }

  /** Puts [[ ]] around one mention in the note `sourceId`. 409 when that note has changed since the list was made. */
  @Post(':sourceId/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  async link(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('sourceId', ParseUUIDPipe) sourceId: string,
    @Body() dto: LinkMentionDto,
  ): Promise<void> {
    // Linking writes into another of the owner's notes: the owner's to do.
    await this.access.note(user.id, noteId, 'owner');
    return this.mentions.link(user.id, noteId, sourceId, dto);
  }
}
