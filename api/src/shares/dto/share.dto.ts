import { IsISO8601, IsNotEmpty, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Left out means "leave as it is", null means "take it away". */
const given = (_object: object, value: unknown) => value !== undefined && value !== null;

export class ShareOptionsDto {
  /** When the link stops working, as an ISO date and time in the future. null lifts the limit. */
  @ValidateIf(given)
  @IsISO8601({ strict: true }, { message: 'expiresAt must be a date and time such as 2026-03-01T12:00:00Z' })
  expiresAt?: string | null;

  /** What readers have to type before they see the note. null takes the password away. */
  @ValidateIf(given)
  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters long' })
  @MaxLength(72, { message: 'password must be at most 72 characters long' })
  password?: string | null;
}

export class UnlockShareDto {
  /** In the body, never in the address: addresses end up in logs and histories. */
  @IsString()
  @IsNotEmpty({ message: 'password is required' })
  @MaxLength(72, { message: 'password must be at most 72 characters long' })
  password: string;
}
