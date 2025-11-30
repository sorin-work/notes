import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/transforms';
import { MAX_TAG_LENGTH } from '../tag-name';

export class RenameTagDto {
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(MAX_TAG_LENGTH)
  name: string;
}
