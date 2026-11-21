import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginCodeDto {
  /** The `ticket` from `POST /auth/login`. */
  @IsString()
  @IsNotEmpty({ message: 'ticket is required' })
  @MaxLength(2000)
  ticket: string;

  /** Six digits from the authenticator app, or a recovery code. */
  @IsString()
  @IsNotEmpty({ message: 'code is required' })
  @MaxLength(40)
  code: string;
}
