import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ConfirmEmailDto {
  /** The token from the link mailed to the new address. */
  @IsString()
  @IsNotEmpty({ message: 'token is required' })
  @MaxLength(200)
  token: string;
}
