import type { Notebook, SharedThrough } from '../api/types';

/**
 * The shared notebook that something would become public through once it is
 * put into `target`, when that is a notebook it is not public through
 * already. Null when the move makes nothing public that was not before.
 */
export function newlyPublicThrough(
  notebooks: Notebook[],
  target: string | null,
  now: SharedThrough | null,
): SharedThrough | null {
  if (target === null) return null;
  const through = notebooks.find((notebook) => notebook.id === target)?.sharedThrough ?? null;
  return through && through.id !== now?.id ? through : null;
}
