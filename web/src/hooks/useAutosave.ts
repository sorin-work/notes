import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

export interface ConflictHandling<T> {
  /**
   * Whether a save failed because the value was based on something that has
   * changed since, and not because the server could not be reached. Sending
   * the same value again would fail the same way, so it is not retried.
   */
  isConflict: (error: unknown) => boolean;
  /** Called when a save runs into a conflict. */
  onConflict?: (error: unknown) => void;
  /**
   * Saves the value over a conflict that was never resolved. It is used when
   * the component goes away, so that leaving does not drop the value.
   */
  saveOver: (value: T, conflict: unknown) => Promise<unknown>;
}

/**
 * What to do with a value that is still unsaved when the component goes
 * away. The last save is tried after the component is gone, so nothing on
 * screen can report how it went.
 */
export interface Farewell<T> {
  /** Called at once with the unsaved value, before the save is tried, to put it somewhere safe. */
  keep: (value: T) => void;
  /** Called when that save went through, so what `keep` put aside is no longer needed. */
  saved: () => void;
  /** Called when it did not: the value only exists where `keep` put it. */
  failed: () => void;
}

/**
 * Saves the latest value a moment after the last change. Saves run one at a
 * time, and whatever is still pending is saved when the component unmounts,
 * so switching notes quickly does not lose the last keystrokes.
 *
 * A save that fails is tried again with the next change or flush. A save
 * that runs into a conflict is not: the value is kept, later changes replace
 * it without being sent, and it stays that way until `retry` or `discard`.
 */
export function useAutosave<T>(
  save: (value: T) => Promise<unknown>,
  delay = 800,
  conflicts?: ConflictHandling<T>,
  farewell?: Farewell<T>,
) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  /** The error of the save that ran into a conflict, until it is resolved. */
  const [conflict, setConflict] = useState<unknown>(null);
  const saveRef = useRef(save);
  const conflictsRef = useRef(conflicts);
  const farewellRef = useRef(farewell);
  const pending = useRef<{ value: T } | null>(null);
  const unresolved = useRef<{ error: unknown } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    saveRef.current = save;
    conflictsRef.current = conflicts;
    farewellRef.current = farewell;
  }, [save, conflicts, farewell]);

  const show = useCallback((next: SaveStatus, error: unknown = null) => {
    if (!mounted.current) return;
    setStatus(next);
    setConflict(error);
  }, []);

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const next = pending.current;
      if (!next || unresolved.current) return;
      pending.current = null;
      show('saving');
      try {
        await saveRef.current(next.value);
        show(pending.current ? 'pending' : 'saved');
      } catch (error) {
        // Keep the value, unless a newer one came in while this one was on its way.
        pending.current ??= next;
        if (conflictsRef.current?.isConflict(error)) {
          unresolved.current = { error };
          show('conflict', error);
          if (mounted.current) conflictsRef.current.onConflict?.(error);
        } else {
          show('error');
        }
      }
    });
    return chain.current;
  }, [show]);

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value };
      // During a conflict the value is only kept. Nothing is sent before it is resolved.
      if (unresolved.current) return;
      setStatus('pending');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  /** Ends a conflict and saves the kept value again, after the caller dealt with what made it conflict. */
  const retry = useCallback((): Promise<void> => {
    unresolved.current = null;
    show(pending.current ? 'pending' : 'saved');
    return flush();
  }, [flush, show]);

  /** Ends a conflict or a failed save by dropping the value that was kept. */
  const discard = useCallback(() => {
    clearTimeout(timer.current);
    unresolved.current = null;
    pending.current = null;
    show('saved');
  }, [show]);

  /**
   * For when the value is about to go out of reach: saves what is pending,
   * and saves over a conflict that is still open.
   */
  const leave = useCallback((): Promise<void> => {
    void flush();
    chain.current = chain.current.then(async () => {
      const kept = pending.current;
      const open = unresolved.current;
      if (!kept || !open || !conflictsRef.current) return;
      pending.current = null;
      unresolved.current = null;
      try {
        await conflictsRef.current.saveOver(kept.value, open.error);
        show('saved');
      } catch {
        pending.current ??= kept;
        unresolved.current = open;
      }
    });
    return chain.current;
  }, [flush, show]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const unsaved = pending.current;
      const farewell = farewellRef.current;
      // Put aside first: the save below may fail, or never answer at all.
      if (unsaved) farewell?.keep(unsaved.value);
      void leave().then(() => {
        if (!unsaved) return;
        if (pending.current) farewell?.failed();
        else farewell?.saved();
      });
    };
  }, [leave]);

  return {
    status,
    conflict,
    schedule,
    flush,
    retry,
    discard,
    leave,
    hasPending: () => pending.current !== null,
    /** The value that is not saved yet, if there is one. */
    pendingValue: () => pending.current?.value ?? null,
  };
}
