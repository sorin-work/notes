import { Controller, Get, Query } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { Page, PaginationQuery } from '../common/pagination';
import { SearchHit, SearchService } from './search.service';

export class SearchQuery extends PaginationQuery {
  @IsString()
  @MaxLength(200)
  q: string;
}

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@CurrentUser() user: AuthUser, @Query() query: SearchQuery): Promise<Page<SearchHit>> {
    return this.searchService.search(user.id, query.q, query);
  }
}
