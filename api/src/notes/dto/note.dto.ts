import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  NotContains,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { ToBoolean, Trim } from '../../common/transforms';
import { MAX_TAG_LENGTH } from '../../tags/tag-name';

export const MAX_TITLE_LENGTH = 200;
/** PostgreSQL cannot store this character in text, so a value with it in can never match anything. */
const NUL = '\0';
/** About 500 pages of text. */
export const MAX_CONTENT_LENGTH = 1_000_000;
/** The largest number the revision column can hold. */
const MAX_REVISION = 2_147_483_647;

/** Longest text a placeholder is filled with. A date or a time needs far less. */
const MAX_PLACEHOLDER_LENGTH = 100;

/**
 * The values for the placeholders of a template. They are worked out in the
 * browser, which knows the user's time zone, and arrive as plain text.
 */
export class PlaceholdersDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_PLACEHOLDER_LENGTH)
  @NotContains(NUL, { message: 'date must not contain a null character' })
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_PLACEHOLDER_LENGTH)
  @NotContains(NUL, { message: 'time must not contain a null character' })
  time?: string;
}

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

  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

  /**
   * Make the note from this template: its content and tags are copied, with
   * the placeholders filled in. A title, content or tags sent along take the
   * place of what the template would have given.
   */
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PlaceholdersDto)
  placeholders?: PlaceholdersDto;
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

  /**
   * The revision of the note that the title or content in this request was
   * based on. When the note has moved on since, the request is refused with
   * a 409 that carries the note as it is now. Without it the last write
   * wins. It is ignored when neither title nor content is sent.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_REVISION)
  revision?: number;

  /** Save the text this request replaces as a version, whatever the usual interval between versions. */
  @IsOptional()
  @IsBoolean()
  keepVersion?: boolean;

  /** Turns the note into a template, or back into a note. Like pinning, it is no change to the text. */
  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;

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
  /** List the templates. Without it the list is the notes, and no template is in it. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  templates?: boolean;

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

export class RenameLinksDto {
  /** The title the note had before it was renamed, which the links still point at. */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  @NotContains(NUL, { message: 'from must not contain a null character' })
  from: string;
}
