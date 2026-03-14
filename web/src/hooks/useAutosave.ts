import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

/**
 * Saves the latest value a moment after the last change. Saves run one at a
 * time, and whatever is still pending is saved when the component unmounts,
 * so switching notes quickly does not lose the last keystrokes.
 */
export function useAutosave<T>(save: (value: T) => Promise<unknown>, delay = 800) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const saveRef = useRef(save);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const setStatusIfMounted = useCallback((next: SaveStatus) => {
    if (mounted.current) setStatus(next);
  }, []);

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const next = pending.current;
      if (!next) return;
      pending.current = null;
      setStatusIfMounted('saving');
      try {
        await saveRef.current(next.value);
        setStatusIfMounted(pending.current ? 'pending' : 'saved');
      } catch {
        // Keep the value so the next change or flush tries again.
        pending.current ??= next;
        setStatusIfMounted('error');
      }
    });
    return chain.current;
  }, [setStatusIfMounted]);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      setStatus('pending');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void flush();
    };
  }, [flush]);

  return { status, schedule, flush, hasPending: () => pending.current !== null };
}
