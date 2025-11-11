import { Transform } from 'class-transformer';

/** Trims string input so "  " fails @IsNotEmpty and names are stored clean. */
export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Accepts "true"/"false" in query strings. */
export const ToBoolean = () =>
  Transform(({ value }) => {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return value;
  });
