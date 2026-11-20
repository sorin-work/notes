/**
 * The service worker, built into /sw.js by build/service-worker.ts. It
 * caches the files of one build, answers the app's pages from the network or,
 * without one, with the cached index.html, and leaves everything else, the
 * API above all, to the network. To take it out of use, see sw-retire/sw.js.
 *
 * A new build installs next to the old one and waits. The page offers a
 * reload, and only when the user takes it does the new worker take over, so
 * an open note is never reloaded under someone's hands.
 */
import { CACHE_PREFIX, cacheName, NAVIGATION_TIMEOUT_MS, routeFor, SKIP_WAITING } from './routing';

// Filled in at build time.
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

// The few parts of the service worker API used here. The DOM types of the
// app do not include them, and the WebWorker ones clash with the DOM ones.
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  location: Location;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

const scope = self as unknown as WorkerScope;
const CACHE = cacheName(__VERSION__);
const PRECACHE = new Set(__PRECACHE__);

scope.addEventListener('install', (event) => {
  // `reload` skips the browser's HTTP cache, so the files cached are the ones of this build.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll([...PRECACHE].map((path) => new Request(path, { cache: 'reload' })))),
  );
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE) await caches.delete(name);
      }
      await scope.clients.claim();
    })(),
  );
});

scope.addEventListener('message', (event) => {
  if (event.data === SKIP_WAITING) void scope.skipWaiting();
});

async function fromCache(path: string, request: Request): Promise<Response> {
  const cached = await caches.open(CACHE).then((cache) => cache.match(path));
  return cached ?? fetch(request);
}

/** A page of the app: from the network when it answers in time, otherwise the cached shell. */
async function shell(request: Request): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fetch(request), late]);
  } catch {
    return fromCache('/index.html', request);
  } finally {
    clearTimeout(timer);
  }
}

scope.addEventListener('fetch', (event) => {
  const route = routeFor(event.request, scope.location.origin, PRECACHE);
  if (route === 'network') return;
  event.respondWith(
    route === 'shell' ? shell(event.request) : fromCache(new URL(event.request.url).pathname, event.request),
  );
});
