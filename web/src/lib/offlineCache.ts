import { hydrate, type Query, type QueryClient } from '@tanstack/react-query';
import { type PersistedClient, persistQueryClientSave } from '@tanstack/react-query-persist-client';
import type { User } from '../api/types';

/**
 * The notes this browser has shown, kept in IndexedDB so that they can be
 * read again without a connection. One record per user, under the user's
 * id: the TanStack Query cache, or the part of it that may be kept, and the
 * user it belongs to.
 *
 * What may be kept is a short list of query keys: notes, the note lists,
 * notebooks, tags and the links of a note. Nothing else is written, so no
 * token, no share password, nothing from the settings pages and no search
 * result ends up on disk. The token stays where it was, in localStorage.
 *
 * The record goes when the user signs out, is signed out (a 401, "sign out
 * everywhere" seen from another tab), deletes the account, or when another
 * user signs in on this browser. See AuthContext.
 */

const DB_NAME = 'notes-offline';
const STORE = 'caches';

/** Query keys whose data may be kept on disk. */
export const KEPT_QUERIES = ['note', 'notes', 'notebooks', 'tags', 'links'] as const;
/** A kept copy older than this is thrown away instead of shown. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** The most that is kept per user. Past it, the queries used longest ago are left out. */
export const MAX_BYTES = 5 * 1024 * 1024;
/** Changes are written at most this often. */
const WRITE_DELAY_MS = 1000;
/** Changes when what is kept changes shape, so that an older copy is not read back. */
const BUSTER = 'v1';

export interface CacheRecord {
  userId: string;
  user: User;
  client: PersistedClient;
}

export function isKept(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  const [first, second] = query.queryKey;
  // Search results sit under 'notes' so that they refresh with the lists, but stay online only.
  if (first === 'notes' && second === 'search') return false;
  return (
    typeof first === 'string' && (KEPT_QUERIES as readonly string[]).includes(first) && query.state.status === 'success'
  );
}

/** The user id in a login token, read without checking it: it only picks which copy to open. */
export function tokenUserId(token: string | null): string | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

// IndexedDB itself -----------------------------------------------------------

let opened: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'userId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
  });
  return opened;
}

function run<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return database().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request ? request.result : undefined);
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB failed'));
      }),
  );
}

// Every write and every removal goes through one queue, so a removal is never
// overtaken by a write that was already on its way.
let queue: Promise<unknown> = Promise.resolve();
function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

const available = () => typeof indexedDB !== 'undefined';

export function readRecord(userId: string): Promise<CacheRecord | undefined> {
  if (!available()) return Promise.resolve(undefined);
  return queued(() => run<CacheRecord>('readonly', (store) => store.get(userId))).catch(() => undefined);
}

export function writeRecord(record: CacheRecord): Promise<void> {
  return queued(() => run('readwrite', (store) => void store.put(record))).then(() => undefined);
}

/** Removes the kept copy of one user. */
export function dropOfflineCache(userId: string): Promise<void> {
  if (!available()) return Promise.resolve();
  return queued(() => run('readwrite', (store) => void store.delete(userId)))
    .then(() => undefined)
    .catch(() => undefined);
}

/** Removes the kept copies of everyone but `keep`. */
export function dropOtherOfflineCaches(keep: string | null): Promise<void> {
  if (!available()) return Promise.resolve();
  return queued(async () => {
    const ids = ((await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())) ?? []) as string[];
    for (const id of ids) if (id !== keep) await run('readwrite', (store) => void store.delete(id));
  }).catch(() => undefined);
}

/** The ids of the users who have a kept copy here. For tests and for the settings page. */
export async function offlineCacheUsers(): Promise<string[]> {
  if (!available()) return [];
  return ((await queued(() => run<IDBValidKey[]>('readonly', (store) => store.getAllKeys()))) ?? []) as string[];
}

// Keeping the query cache ----------------------------------------------------

/** Leaves out the queries used longest ago until what is kept fits in `maxBytes`. */
export function withinSize(client: PersistedClient, maxBytes = MAX_BYTES): PersistedClient {
  const queries = [...client.clientState.queries].sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  const size = (list: typeof queries) => new Blob([JSON.stringify(list)]).size;
  while (queries.length > 0 && size(queries) > maxBytes) queries.pop();
  return { ...client, clientState: { ...client.clientState, queries, mutations: [] } };
}

export interface OfflineCache {
  /** Stops writing. What is on disk stays. */
  stop(): void;
}

/**
 * Reads back what was kept for `user` into the query client, then keeps
 * writing changes. The returned promise resolves once the copy is read, so
 * the app can wait for it before it shows notes. `wanted` is asked right
 * before the copy goes into memory: a user who signed out in the meantime
 * must not have their notes put back.
 */
export async function keepOffline(
  queryClient: QueryClient,
  user: User,
  wanted: () => boolean = () => true,
): Promise<OfflineCache> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (!available()) return { stop: () => undefined };

  const persister = {
    persistClient: async (client: PersistedClient) => {
      if (stopped) return;
      await writeRecord({ userId: user.id, user, client: withinSize(client) });
    },
    restoreClient: async () => (await readRecord(user.id))?.client,
    removeClient: () => dropOfflineCache(user.id),
  };
  const options = {
    queryClient,
    persister,
    maxAge: MAX_AGE_MS,
    buster: BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: isKept, shouldDehydrateMutation: () => false },
  };

  const record = await readRecord(user.id);
  if (record) {
    const { timestamp, buster, clientState } = record.client;
    if (Date.now() - timestamp > MAX_AGE_MS || buster !== BUSTER) await dropOfflineCache(user.id);
    else if (wanted()) hydrate(queryClient, clientState);
  }

  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!stopped) void persistQueryClientSave(options).catch(() => undefined);
    }, WRITE_DELAY_MS);
  };
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'added' || event.type === 'removed' || event.type === 'updated') save();
  });
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
    },
  };
}
