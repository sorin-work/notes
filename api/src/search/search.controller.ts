import { Controller, Get, Query } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';
import { AccessService } from '../access/access.service';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Page } from '../common/pagination';
import { NoteFilterQuery } from '../notes/dto/note.dto';
import { SearchHit, SearchService } from './search.service';

export class SearchQuery extends NoteFilterQuery {
  // Spelled out because the build only reads *.dto.ts files for the API document.
  @ApiProperty({
    description: 'What to look for. Words match as prefixes, "quoted words" as a phrase.',
    maxLength: 200,
  })
  @IsString()
  @MaxLength(200)
  q: string;
}

@AllowApiToken()
@Controller('search')
export class SearchController {
  constructor(
    private readonly searchService: SearchService,
    private readonly access: AccessService,
  ) {}

  /**
   * Full-text search over titles and text, best match first. Your own notes,
   * or, with `notebookId` of a notebook shared with you, the notes in it.
   */
  @Get()
  async search(@CurrentUser() user: AuthUser, @Query() query: SearchQuery): Promise<Page<SearchHit>> {
    const { ownerId } = await this.access.ownerForFilter(user.id, query.notebookId);
    return this.searchService.search(ownerId, query.q, query);
  }
}
