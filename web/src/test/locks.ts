/**
 * jsdom has no Web Locks. This stands in for them with one queue per lock
 * name, shared by everything in the test, like the browser shares them
 * between tabs. Exclusive locks only, which is all the app asks for.
 */
const queues = new Map<string, Promise<unknown>>();

const locks = {
  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const previous = queues.get(name) ?? Promise.resolve();
    const next = previous.then(callback, callback);
    queues.set(
      name,
      next.catch(() => undefined),
    );
    return next;
  },
};

if (!('locks' in navigator)) {
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
}

/** For tests that need a lock queue that nothing earlier left waiting. */
export function resetLocks(): void {
  queues.clear();
}
