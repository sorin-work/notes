import { createHash } from 'node:crypto';
import { sep } from 'node:path';

export const WORKER_FILE = 'sw.js';
/** Says which build is deployed. Never cached, so an open tab can compare it with its own. */
export const VERSION_FILE = 'version.json';

/**
 * What the worker caches: every file of the build and of `public/`, but not
 * source maps and not the worker itself. These are the same for everyone,
 * so no private data can end up in the cache.
 */
export function precacheList(files: Iterable<string>): string[] {
  return [...new Set(files)]
    .filter((file) => !file.endsWith('.map') && file !== WORKER_FILE && file !== VERSION_FILE)
    .map((file) => `/${file.split(sep).join('/')}`)
    .sort();
}

/** A version that changes whenever any cached file changes, including the ones in public/ that keep their names. */
export function buildVersion(contents: Iterable<[string, string | Uint8Array]>): string {
  const hash = createHash('sha256');
  for (const [name, content] of [...contents].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name).update('\0').update(content).update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}
