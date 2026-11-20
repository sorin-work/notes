import { useSyncExternalStore } from 'react';
import { SKIP_WAITING } from '../sw/routing';
import { putUnsavedWorkAside, saveUnsavedWork } from './unsavedWork';

declare const __BUILD_ID__: string;

/**
 * The service worker and new versions of the app. The worker is only
 * registered for a production build: in development Vite serves the files
 * itself and a worker would only get in the way.
 *
 * A new build installs in the background and waits. While it waits, the page
 * offers to reload, and nothing reloads by itself. Once one tab takes the
 * offer, the new worker takes over every tab, and the old files are gone. So
 * every tab then reloads too, after saving its open note. A tab that cannot
 * save puts the draft aside and asks to be reloaded instead of running on.
 *
 * /version.json says which build is deployed. A tab that finds another one
 * there offers a reload as well, also when there is no worker to tell it.
 */
export type UpdateState = 'none' | 'available' | 'must-reload';

let state: UpdateState = 'none';
let waiting: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function setState(next: UpdateState, worker: ServiceWorker | null = waiting) {
  waiting = worker;
  // A reload that is owed is not taken back by news of a newer version.
  if (state === 'must-reload' && next !== 'none') return notify();
  state = next;
  notify();
}

function notify() {
  for (const listener of listeners) listener();
}

/** How often an open tab asks whether there is a new build. */
export const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** Watches a registration for a new worker that is ready and waiting for this tab to let it take over. */
export function watchRegistration(registration: ServiceWorkerRegistration, container: ServiceWorkerContainer): void {
  // A worker that waits without a controller is the first one, which takes over by itself.
  if (registration.waiting && container.controller) setState('available', registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed' && container.controller) setState('available', installing);
    });
  });
}

/**
 * Reloads every tab once a new worker has taken over, when this tab had an
 * old one: the first worker of a visit also takes over, and that changes
 * nothing about the files the tab runs.
 */
export function followNewWorker(
  container: ServiceWorkerContainer,
  reload: () => void = () => window.location.reload(),
): void {
  if (!container.controller) return;
  container.addEventListener(
    'controllerchange',
    () =>
      void (async () => {
        if (await saveUnsavedWork()) {
          reload();
          return;
        }
        putUnsavedWorkAside();
        setState('must-reload', null);
      })(),
    { once: true },
  );
}

/** Asks /version.json which build is deployed. A different one than this tab runs means there is a new version. */
export async function checkDeployedVersion(
  registration?: ServiceWorkerRegistration,
  own: string = __BUILD_ID__,
): Promise<void> {
  try {
    const response = await fetch('/version.json', { cache: 'no-store' });
    if (!response.ok) return;
    const { build } = (await response.json()) as { build?: unknown };
    if (typeof build !== 'string' || build === own) return;
    // The worker usually finds the new build too. Without one, the offer is a plain reload.
    if (registration) await registration.update().catch(() => undefined);
    if (state === 'none') setState('available', waiting);
  } catch {
    // Offline, or the file is not there: nothing to learn.
  }
}

export async function registerServiceWorker(container: ServiceWorkerContainer | undefined = navigator.serviceWorker) {
  if (!container) {
    const check = () => void checkDeployedVersion();
    window.setInterval(check, UPDATE_CHECK_MS);
    return;
  }
  followNewWorker(container);
  const registration = await container.register('/sw.js');
  watchRegistration(registration, container);
  const check = () => {
    void registration.update().catch(() => undefined);
    void checkDeployedVersion(registration);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
  window.setInterval(check, UPDATE_CHECK_MS);
}

/**
 * Switches to the new version: saves what is open first, then lets the new
 * worker take over. Every tab, this one included, reloads once it has (see
 * followNewWorker). Without a waiting worker it simply reloads. Resolves to
 * false, and does nothing, when something could not be saved.
 */
export async function applyUpdate(reload: () => void = () => window.location.reload()): Promise<boolean> {
  if (!(await saveUnsavedWork())) return false;
  if (waiting) waiting.postMessage(SKIP_WAITING);
  else reload();
  return true;
}

export function useUpdateState(): UpdateState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** For tests. */
export function resetAppUpdate(): void {
  state = 'none';
  waiting = null;
  notify();
}
