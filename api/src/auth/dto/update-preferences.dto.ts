import { Type } from 'class-transformer';
import { IsIn, IsUUID, ValidateIf, ValidateNested } from 'class-validator';
import { DATE_FORMATS, DateFormat } from '../../common/day';
import { IfPresent } from '../../common/transforms';

export class DailyNotesPreferencesDto {
  /** The notebook new daily notes go into. null for none. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  notebookId?: string | null;

  /** The template new daily notes are made from. null for an empty note. */
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  templateId?: string | null;

  /**
   * How the day is written in the title: `iso` (2026-11-20), `long` (20 November 2026) or `us` (November 20, 2026).
   * There is always a format, so unlike the two above this one cannot be null.
   */
  @IfPresent()
  @IsIn(DATE_FORMATS)
  dateFormat?: DateFormat;
}

/** Only what is sent changes. The rest of the preferences stays as it is. */
export class UpdatePreferencesDto {
  @IfPresent()
  @ValidateNested()
  @Type(() => DailyNotesPreferencesDto)
  dailyNotes?: DailyNotesPreferencesDto;
}
