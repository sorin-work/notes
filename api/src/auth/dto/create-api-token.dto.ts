import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Trim } from '../../common/transforms';

export class CreateApiTokenDto {
  /** What the token is for, e.g. "backup script". Shown in Settings. */
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsBoolean()
  readOnly?: boolean;
}
