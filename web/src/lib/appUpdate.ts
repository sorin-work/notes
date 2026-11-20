import { useSyncExternalStore } from 'react';
import { SKIP_WAITING } from '../sw/routing';
import { saveUnsavedWork } from './unsavedWork';

/**
 * The service worker and the "new version" offer. The worker is only
 * registered for a production build: in development Vite serves the files
 * itself and a worker would only get in the way.
 *
 * A new build installs in the background and waits. While it waits, the
 * page is told there is a new version and offers to reload. Nothing reloads
 * by itself, so a note is never reloaded while it is being written.
 */
type Listener = () => void;

let waiting: ServiceWorker | null = null;
const listeners = new Set<Listener>();

function setWaiting(worker: ServiceWorker | null) {
  waiting = worker;
  for (const listener of listeners) listener();
}

/** How often an open tab asks whether there is a new build. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Watches a registration for a new worker that is ready and waiting for this tab to let it take over. */
export function watchRegistration(registration: ServiceWorkerRegistration, container: ServiceWorkerContainer): void {
  // A worker that waits without a controller is the first one, which takes over by itself.
  if (registration.waiting && container.controller) setWaiting(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && container.controller) setWaiting(installing);
    });
  });
}

export async function registerServiceWorker(container: ServiceWorkerContainer | undefined = navigator.serviceWorker) {
  if (!container) return;
  const registration = await container.register('/sw.js');
  watchRegistration(registration, container);
  const check = () => void registration.update().catch(() => undefined);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.setInterval(check, UPDATE_CHECK_MS);
}

/**
 * Switches to the new version: saves what is open first, then lets the new
 * worker take over and reloads once it has. Resolves to false, and does
 * nothing, when something could not be saved.
 */
export async function applyUpdate(
  container: ServiceWorkerContainer = navigator.serviceWorker,
  reload: () => void = () => window.location.reload(),
): Promise<boolean> {
  const worker = waiting;
  if (!worker) return false;
  if (!(await saveUnsavedWork())) return false;
  container.addEventListener('controllerchange', () => reload(), { once: true });
  worker.postMessage(SKIP_WAITING);
  return true;
}

export function useUpdateWaiting(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => waiting !== null,
  );
}

/** For tests. */
export function resetAppUpdate(): void {
  setWaiting(null);
}
