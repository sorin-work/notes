import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { MAX_CONTENT_LENGTH } from '../../notes/dto/note.dto';

/** Which mention to link: the three values the list of mentions gave for it. */
export class LinkMentionDto {
  /** Where the mention starts in the text of the other note. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_CONTENT_LENGTH)
  offset: number;

  /** The mention as it is written there. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text: string;

  /** The state of the other note that the mention was found in. */
  @IsString()
  @Matches(/^[0-9a-f]{64}$/, { message: 'version must be the version from the list of mentions' })
  version: string;
}
