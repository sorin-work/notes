import { hydrate, type Query, type QueryClient } from '@tanstack/react-query';
import { type PersistedClient, persistQueryClientSave } from '@tanstack/react-query-persist-client';
import { ApiError, getToken } from '../api/client';
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
  if (typeof first !== 'string' || !(KEPT_QUERIES as readonly string[]).includes(first)) return false;
  if (query.state.data === undefined) return false;
  // A refetch that failed keeps what was there: a flaky connection must not
  // take away what the user reads offline. Only the server saying that the
  // note is gone, or not theirs, does.
  const { error } = query.state;
  return !(error instanceof ApiError && (error.status === 404 || error.status === 403));
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

type KeptQuery = PersistedClient['clientState']['queries'][number];

/** Whether the data of a query was fetched within the age limit. The limit runs from each fetch, not from the last write. */
const fresh = (query: KeptQuery, now: number) => now - query.state.dataUpdatedAt <= MAX_AGE_MS;

/**
 * What goes on disk: queries whose data is not past the age limit, as plain
 * successful data (a failed refetch is kept as the data it had), the newest
 * first, leaving out the ones loaded longest ago once `maxBytes` is reached.
 * Each query is measured once.
 */
export function forDisk(client: PersistedClient, maxBytes = MAX_BYTES, now = Date.now()): PersistedClient {
  const encoder = new TextEncoder();
  const kept: KeptQuery[] = [];
  let total = 2;
  const newestFirst = client.clientState.queries
    .filter((query) => fresh(query, now))
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const query of newestFirst) {
    const clean: KeptQuery = {
      ...query,
      state: { ...query.state, status: 'success', error: null, fetchFailureReason: null, fetchStatus: 'idle' },
    };
    const size = encoder.encode(JSON.stringify(clean)).length + 1;
    if (total + size > maxBytes) break;
    total += size;
    kept.push(clean);
  }
  return { ...client, clientState: { ...client.clientState, queries: kept, mutations: [] } };
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
      // Never under the wrong name: another tab may have signed in as someone else meanwhile.
      if (stopped || tokenUserId(getToken()) !== user.id) return;
      await writeRecord({ userId: user.id, user, client: forDisk(client) });
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
    const { buster, clientState } = record.client;
    const now = Date.now();
    const queries = clientState.queries.filter((query) => fresh(query, now));
    if (buster !== BUSTER || queries.length === 0) await dropOfflineCache(user.id);
    else if (wanted()) hydrate(queryClient, { ...clientState, queries });
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
