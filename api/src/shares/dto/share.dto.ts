import {
  isISO8601,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidateIf,
  type ValidationOptions,
} from 'class-validator';

/** Left out means "leave as it is", null means "take it away". */
const given = (_object: object, value: unknown) => value !== undefined && value !== null;

/** A date, or a date and time with its zone: 2026-03-01, 2026-03-01T12:00:00Z, 2026-03-01T13:00:00.000+01:00. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/**
 * A date and time that means one moment and that `new Date()` reads as that
 * moment. IsISO8601 alone is not enough. It lets through forms that
 * `new Date()` cannot read ("2027-W01", "20270101"), forms it reads as
 * something else ("-2027-01-01" becomes the year 2027), and times without a
 * zone, which would mean the server's.
 */
export function isDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    DATE_TIME.test(value) &&
    isISO8601(value, { strict: true }) &&
    !Number.isNaN(new Date(value).getTime())
  );
}

function IsDateTime(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isDateTime',
      target: object.constructor,
      propertyName,
      options,
      validator: { validate: isDateTime },
    });
}

export class ShareOptionsDto {
  /** When the link stops working, as an ISO date and time in the future. null lifts the limit. */
  @ValidateIf(given)
  @IsDateTime({ message: 'expiresAt must be a date and time such as 2026-03-01T12:00:00Z' })
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
