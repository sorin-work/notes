import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'currentPassword is required' })
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters long' })
  @MaxLength(72, { message: 'newPassword must be at most 72 characters long' })
  newPassword: string;
}
