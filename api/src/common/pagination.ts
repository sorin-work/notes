import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Far beyond any real list, and small enough that the offset still fits in an integer. */
export const MAX_PAGE = 100_000;

export class PaginationQuery {
  // The two below have a default instead of a "?", which the API document
  // would read as "required" and of no known type. So it is told.
  @ApiPropertyOptional({ type: 'integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page = 1;

  @ApiPropertyOptional({ type: 'integer' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function skipFor(query: PaginationQuery): number {
  return (query.page - 1) * query.pageSize;
}
