import { useCallback, useState } from 'react';

/** useState that remembers its value in localStorage. */
export function useStoredState<T extends string>(key: string, allowed: readonly T[], fallback: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key) as T | null;
      return saved && allowed.includes(saved) ? saved : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        // Not remembered, but still applied.
      }
    },
    [key],
  );

  return [value, update] as const;
}
