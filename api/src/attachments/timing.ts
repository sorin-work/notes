/**
 * A restore of a JSON backup is one transaction for the whole file, read
 * while the upload comes in. Prisma ends a transaction after five seconds
 * unless told otherwise; an hour leaves room for a large backup over a slow
 * line.
 */
export const RESTORE_TIMEOUT_MS = 60 * 60 * 1000;

/**
 * How old a file without a row has to be before the sweep removes it. A
 * restore and an upload write their files before the rows, which only exist
 * once their transaction commits, so this is well past the longest a
 * restore may take.
 */
export const SWEEP_GRACE_MS = 2 * RESTORE_TIMEOUT_MS;
