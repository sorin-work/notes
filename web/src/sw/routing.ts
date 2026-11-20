/**
 * What the service worker does with a request. Kept apart from the worker so
 * that it can be tested, and so that the one rule that matters is in one
 * place: nothing under /api/ is ever answered from, or put into, a cache.
 * The worker only holds the files of the build, which hold no one's notes.
 *
 * - `network`: left alone, as if there were no worker.
 * - `precache`: a file of the build, answered from the cache of this version.
 * - `shell`: a page of the app (a navigation), answered with the cached
 *   index.html, so the app starts without a connection.
 */
export type Route = 'network' | 'precache' | 'shell';

export interface RequestInfo {
  method: string;
  url: string;
  mode: string;
}

/** Paths that are served by something other than the app, even when navigated to. */
function passesThrough(path: string): boolean {
  return path === '/api' || path.startsWith('/api/') || path === '/healthz';
}

export function routeFor(request: RequestInfo, origin: string, precached: ReadonlySet<string>): Route {
  if (request.method !== 'GET') return 'network';
  const url = new URL(request.url);
  if (url.origin !== origin || passesThrough(url.pathname)) return 'network';
  if (precached.has(url.pathname)) return 'precache';
  if (request.mode === 'navigate') return 'shell';
  return 'network';
}

/** The caches this worker owns are named after the build, so an old one is easy to tell and remove. */
export const CACHE_PREFIX = 'notes-shell-';
export const cacheName = (version: string) => `${CACHE_PREFIX}${version}`;

/** The message the page sends when the user asks for the new version. */
export const SKIP_WAITING = 'skip-waiting';
