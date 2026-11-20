import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

/** Trims string input so "  " fails @IsNotEmpty and names are stored clean. */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Accepts "true"/"false" in query strings. */
export const ToBoolean = () =>
  Transform(({ value }) => {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return value;
  });

/**
 * For a field that may be left out of the body. Unlike @IsOptional() it does
 * not wave `null` through: a null name or email is a mistake to answer with
 * a 400, not a value to hand to the database.
 */
export const IfPresent = () => ValidateIf((_object, value) => value !== undefined);
