import { useSyncExternalStore } from 'react';

/**
 * Short messages about something that happened where nobody was looking, for
 * instance to a note that was just left. They outlive the component that
 * raised them and stay until they are dismissed.
 */
export interface Notice {
  id: number;
  text: string;
}

let notices: Notice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: Notice[]): void {
  notices = next;
  for (const listener of listeners) listener();
}

export function notify(text: string): void {
  set([...notices, { id: nextId++, text }]);
}

export function dismissNotice(id: number): void {
  set(notices.filter((notice) => notice.id !== id));
}

/** For signing out: the next person at this screen must not read about someone else's notes. */
export function clearNotices(): void {
  if (notices.length > 0) set([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(subscribe, () => notices);
}
