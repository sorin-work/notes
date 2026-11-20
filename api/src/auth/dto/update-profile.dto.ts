import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IfPresent, Trim } from '../../common/transforms';

export class UpdateProfileDto {
  @IfPresent()
  @Trim()
  @IsString()
  @IsNotEmpty({ message: 'name is required' })
  @MaxLength(100)
  name?: string;

  @IfPresent()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email?: string;

  /** Only needed when the email changes. */
  @IfPresent()
  @IsString()
  currentPassword?: string;
}
