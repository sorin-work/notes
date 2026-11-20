import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  /** The token from the link in the mail. */
  @IsString()
  @IsNotEmpty({ message: 'token is required' })
  @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(72, { message: 'password must be at most 72 characters long' })
  password: string;
}
