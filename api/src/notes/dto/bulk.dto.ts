import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  NotContains,
  ValidateIf,
} from 'class-validator';
import { MAX_TAG_LENGTH } from '../../tags/tag-name';

export const BULK_ACTIONS = ['move', 'addTag', 'removeTag', 'pin', 'unpin', 'trash'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

/** How many notes one request may change. */
export const MAX_BULK_NOTES = 500;

/** One action for many notes. */
export class BulkNotesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_NOTES)
  @IsUUID('all', { each: true })
  ids: string[];

  @IsIn(BULK_ACTIONS)
  action: BulkAction;

  /** For "move": the notebook to move the notes into, or null (or left out) for no notebook. */
  @ValidateIf((dto: BulkNotesDto) => dto.action === 'move')
  @IsOptional()
  @IsUUID()
  notebookId?: string | null;

  /** For "addTag" and "removeTag": the tag, written as it is typed. */
  @ValidateIf((dto: BulkNotesDto) => dto.action === 'addTag' || dto.action === 'removeTag')
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TAG_LENGTH)
  @NotContains('\0', { message: 'tag must not contain a null character' })
  tag?: string;
}
