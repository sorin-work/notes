import { IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

export const MAX_TITLE_LENGTH = 200;
/** About 500 pages of text. */
export const MAX_CONTENT_LENGTH = 1_000_000;

export class CreateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content?: string;

  @IsOptional()
  @IsUUID()
  notebookId?: string | null;
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_CONTENT_LENGTH)
  content?: string;

  /** null takes the note out of its notebook. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  notebookId?: string | null;
}

export class ListNotesQuery extends PaginationQuery {}
