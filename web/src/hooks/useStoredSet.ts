import { useCallback, useState } from 'react';

function read(key: string): Set<string> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * A set of ids that is remembered in localStorage, such as the notebooks
 * that are folded shut in the sidebar. `toggle` puts an id in or takes it out.
 */
export function useStoredSet(key: string) {
  const [ids, setIds] = useState(() => read(key));

  const toggle = useCallback(
    (id: string) => {
      setIds((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        try {
          localStorage.setItem(key, JSON.stringify([...next]));
        } catch {
          // Not remembered, but still applied.
        }
        return next;
      });
    },
    [key],
  );

  return [ids, toggle] as const;
}
