import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  NotContains,
  ValidateIf,
} from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { ToBoolean, Trim } from '../../common/transforms';
import { MAX_TAG_LENGTH } from '../../tags/tag-name';

export const MAX_TITLE_LENGTH = 200;
/** PostgreSQL cannot store this character in text, so a value with it in can never match anything. */
const NUL = '\0';
/** About 500 pages of text. */
export const MAX_CONTENT_LENGTH = 1_000_000;

export class CreateNoteDto {
  @IsOptional()
  @Trim()
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  favorite?: boolean;
}

export class UpdateNoteDto {
  @IsOptional()
  @Trim()
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsBoolean()
  favorite?: boolean;
}

export const NOTE_SORTS = ['updated', 'created', 'title'] as const;
export type NoteSort = (typeof NOTE_SORTS)[number];

/** The notebook and tag filters that the note list and the search share. */
export class NoteFilterQuery extends PaginationQuery {
  /**
   * A notebook id, or "none" for notes that are not in a notebook. The word
   * is matched exactly: the services compare it the same way, and "NONE"
   * would otherwise be handed to the database as an id.
   */
  @IsOptional()
  @Matches(/^(none|[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})$/, {
    message: 'notebookId must be a notebook id or "none"',
  })
  notebookId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TAG_LENGTH)
  @NotContains(NUL, { message: 'tag must not contain a null character' })
  tag?: string;
}

export class ListNotesQuery extends NoteFilterQuery {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  favorite?: boolean;

  @IsOptional()
  @IsIn(NOTE_SORTS)
  sort: NoteSort = 'updated';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class TitleQuery {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  @NotContains(NUL, { message: 'q must not contain a null character' })
  q?: string;

  @IsOptional()
  @Type(() => Number)
  limit?: number;
}

export class ResolveQuery {
  @Trim()
  @IsString()
  @MaxLength(MAX_TITLE_LENGTH)
  @NotContains(NUL, { message: 'title must not contain a null character' })
  title: string;
}
