import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IfPresent, Trim } from '../../common/transforms';

export class CreateApiTokenDto {
  /** What the token is for, e.g. "backup script". Shown in Settings. */
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(100)
  name: string;

  @IfPresent()
  @IsBoolean()
  readOnly?: boolean;

  /**
   * A token outlives every login, also "sign out everywhere". Without the
   * password a stolen login could make itself one.
   */
  @IsString()
  @IsNotEmpty({ message: 'currentPassword is required' })
  currentPassword: string;
}
