import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError } from '../api/client';
import { createNote, getNote, staleNote, updateNote } from '../api/notes';
import type { Note } from '../api/types';
import { savedTitle } from './text';

/**
 * Changes made while the server could not be reached, kept in IndexedDB so
 * that they survive a reload, and sent when the connection is back.
 *
 * How it sits next to the other places a draft can be:
 * - The editor holds the text being typed and saves it a moment later.
 * - When that save cannot reach the server, the text comes here. From then on
 *   every save of that note comes here too, until the outbox has sent it, so
 *   the changes to one note go out in the order they were made.
 * - The draft stash (lib/draftStash.ts) is only for a save the server
 *   refused when nobody was left to ask: the session had ended, or the note
 *   had changed elsewhere once more. Text the server never saw is here, not
 *   there, so the two never hold the same draft.
 *
 * There is at most one entry per note: a new note made offline, or the text
 * of an existing note with the revision it was based on. Later changes
 * replace its text. An entry goes only when the server has it. One that
 * cannot be applied stays, marked, and is shown to the user, who decides.
 */

export type EntryState = 'waiting' | 'conflict' | 'stuck';

export interface OutboxEntry {
  seq?: number;
  userId: string;
  noteId: string;
  kind: 'create' | 'text';
  title: string;
  content: string;
  /** For a new note: where it goes. */
  notebookId?: string | null;
  /** For text: the revision it was written on. The server refuses it if the note has moved on. */
  baseRevision: number;
  /** Put the text it replaces into the history ("keep both"). */
  keepVersion?: boolean;
  /**
   * Texts of this entry that went out without an answer. One of them may
   * have been written all the same: finding it on the server is no conflict.
   */
  maybeSent: { title: string; content: string }[];
  state: EntryState;
  /** For a conflict: the note as the server had it. */
  theirs?: Note;
  /** For an entry that is stuck: why. */
  problem?: string;
  at: string;
}

// Storage ---------------------------------------------------------------------

const DB_NAME = 'notes-outbox';
const STORE = 'entries';
let opened: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
      store.createIndex('userId', 'userId');
    };
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

const available = () => typeof indexedDB !== 'undefined';

async function entriesOf(userId: string): Promise<OutboxEntry[]> {
  if (!available()) return [];
  const all = await run<OutboxEntry[]>('readonly', (store) => store.index('userId').getAll(userId));
  return (all ?? []).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

const put = (entry: OutboxEntry) => run<IDBValidKey>('readwrite', (store) => store.put(entry));
const remove = (seq: number) => run('readwrite', (store) => void store.delete(seq));

// One thing at a time ---------------------------------------------------------

// Everything that reads and changes the entries runs through this chain, in
// this tab. Between tabs, a Web Lock keeps two tabs from sending at once.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

function acrossTabs<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request(`notes-outbox-${userId}`, work) : work();
}

// What the page sees -----------------------------------------------------------

let current: { userId: string; queryClient: QueryClient } | null = null;
let shown: OutboxEntry[] = [];
const listeners = new Set<() => void>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('notes-outbox') : null;

async function refresh(tellOthers = true) {
  shown = current ? await entriesOf(current.userId) : [];
  for (const listener of listeners) listener();
  if (tellOthers) channel?.postMessage('changed');
}

channel?.addEventListener('message', () => void serial(() => refresh(false)));

export function useOutbox(): OutboxEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
  );
}

export const outboxEntryFor = (noteId: string) => shown.find((entry) => entry.noteId === noteId) ?? null;

// Sent notes are told to whoever listens, so an open editor moves its revision on.
type SentListener = (note: Note) => void;
const sentListeners = new Set<SentListener>();
export function onSent(listener: SentListener): () => void {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}

// Queueing --------------------------------------------------------------------

const unreachable = (error: unknown) => error instanceof ApiError && error.status === 0;
export const cannotReachServer = unreachable;

/** Keeps the text of a note to be sent later, on the revision it was written on. */
export function queueText(
  userId: string,
  noteId: string,
  text: { title: string; content: string },
  baseRevision: number,
  maybeSent: { title: string; content: string }[] = [],
): Promise<void> {
  return serial(async () => {
    const [entry] = (await entriesOf(userId)).filter((item) => item.noteId === noteId);
    const sent = maybeSent.map(({ title, content }) => ({ title, content }));
    if (entry) {
      await put({
        ...entry,
        ...text,
        maybeSent: [...entry.maybeSent, ...sent].slice(-10),
        at: new Date().toISOString(),
      });
    } else {
      await put({
        userId,
        noteId,
        kind: 'text',
        ...text,
        baseRevision,
        maybeSent: sent,
        state: 'waiting',
        at: new Date().toISOString(),
      });
    }
    await refresh();
  }).then(() => void replay());
}

/** Makes a note without a connection: an id from the browser, and the note as it will be once sent. */
export async function createOffline(userId: string, start: { notebookId?: string | null }): Promise<Note> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await serial(async () => {
    await put({
      userId,
      noteId: id,
      kind: 'create',
      title: '',
      content: '',
      notebookId: start.notebookId ?? null,
      baseRevision: 0,
      maybeSent: [],
      state: 'waiting',
      at: now,
    });
    await refresh();
  });
  return {
    id,
    title: 'Untitled',
    content: '',
    revision: 0,
    isTemplate: false,
    dailyDate: null,
    notebookId: start.notebookId ?? null,
    notebook: null,
    tags: [],
    pinned: false,
    favorite: false,
    shared: false,
    sharedThrough: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

// Sending ---------------------------------------------------------------------

const sameText = (note: Note, text: { title: string; content: string }) =>
  note.title === savedTitle(text.title) && note.content === text.content;

/** What happened to one entry. `offline` stops the round: the rest would fail the same way. */
type Outcome = { kind: 'sent'; note: Note } | { kind: 'offline' } | { kind: 'kept'; entry: OutboxEntry };

async function send(entry: OutboxEntry): Promise<Outcome> {
  const text = { title: entry.title, content: entry.content };
  try {
    if (entry.kind === 'create') {
      try {
        return { kind: 'sent', note: await createNote({ id: entry.noteId, ...text, notebookId: entry.notebookId }) };
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 409)) throw error;
        // The id is taken. If the note is ours, the create went through before
        // and its answer got lost: what is left to send is the text.
        const ours = await getNote(entry.noteId).catch(() => null);
        if (!ours) {
          return { kind: 'kept', entry: { ...entry, state: 'stuck', problem: 'The id made for this note is taken.' } };
        }
        if (sameText(ours, text)) return { kind: 'sent', note: ours };
        return send({ ...entry, kind: 'text', baseRevision: ours.revision });
      }
    }
    for (let rebased = 0; ; rebased++) {
      try {
        const changes = { ...text, revision: entry.baseRevision, keepVersion: entry.keepVersion || undefined };
        return { kind: 'sent', note: await updateNote(entry.noteId, changes) };
      } catch (error) {
        const theirs = staleNote(error);
        if (!theirs) throw error;
        // Already there: the earlier send went through and only its answer got lost.
        if (sameText(theirs, text)) return { kind: 'sent', note: theirs };
        if (rebased === 0 && entry.maybeSent.some((sent) => sameText(theirs, sent))) {
          // The server holds an earlier text of this entry: ours, so no conflict. Send on top of it.
          entry = { ...entry, baseRevision: theirs.revision };
          continue;
        }
        return { kind: 'kept', entry: { ...entry, state: 'conflict', theirs } };
      }
    }
  } catch (error) {
    if (unreachable(error)) {
      // It may have arrived all the same. If it did, the next round finds this text on the server.
      const maybeSent = [...entry.maybeSent, text].slice(-10);
      return { kind: 'kept', entry: { ...entry, maybeSent, state: 'waiting' } };
    }
    if (error instanceof ApiError && error.status === 401) return { kind: 'offline' };
    const problem = error instanceof Error ? error.message : 'The server refused this change.';
    return { kind: 'kept', entry: { ...entry, state: 'stuck', problem } };
  }
}

let replaying: Promise<void> | null = null;

/**
 * Sends what is waiting, oldest first. Each entry goes through the normal
 * create or save, so a note changed elsewhere meanwhile raises the usual
 * question instead of being overwritten. Running it twice, or on a
 * connection that comes and goes, applies nothing twice.
 */
export function replay(): Promise<void> {
  if (!current) return Promise.resolve();
  replaying ??= (async () => {
    const { userId, queryClient } = current!;
    await acrossTabs(userId, () =>
      serial(async () => {
        for (const entry of await entriesOf(userId)) {
          if (current?.userId !== userId) return;
          if (entry.state !== 'waiting') continue;
          const outcome = await send(entry);
          if (outcome.kind === 'offline') break;
          if (outcome.kind === 'kept') {
            await put(outcome.entry);
            // Still waiting means the server could not be reached: the rest would not get through either.
            if (outcome.entry.state === 'waiting') break;
            continue;
          }
          await remove(entry.seq!);
          queryClient.setQueryData(['note', outcome.note.id], outcome.note);
          void queryClient.invalidateQueries({ queryKey: ['notes'] });
          for (const listener of sentListeners) listener(outcome.note);
        }
        await refresh();
      }),
    );
  })().finally(() => {
    replaying = null;
  });
  return replaying;
}

// Deciding --------------------------------------------------------------------

/**
 * Settles an entry the server would not take as it was: send it over the
 * newer note ("mine"), the same but with that note put into the history
 * ("both"), or give it up ("theirs").
 */
export function resolveEntry(noteId: string, choice: 'mine' | 'both' | 'theirs'): Promise<void> {
  if (!current) return Promise.resolve();
  const { userId } = current;
  return serial(async () => {
    const entry = (await entriesOf(userId)).find((item) => item.noteId === noteId);
    if (!entry) return;
    if (choice === 'theirs') await remove(entry.seq!);
    else {
      const base = entry.theirs?.revision ?? entry.baseRevision;
      await put({
        ...entry,
        kind: 'text',
        baseRevision: base,
        keepVersion: choice === 'both',
        state: 'waiting',
        theirs: undefined,
        problem: undefined,
      });
    }
    await refresh();
  }).then(() => void replay());
}

// Whose outbox ----------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | undefined;
const onOnline = () => void replay();

/** Starts sending for the signed-in user: now, when the connection comes back, and every half minute. */
export function startOutbox(userId: string, queryClient: QueryClient): Promise<void> {
  stopOutbox();
  current = { userId, queryClient };
  window.addEventListener('online', onOnline);
  timer = setInterval(() => {
    if (shown.some((entry) => entry.state === 'waiting')) void replay();
  }, 30_000);
  return serial(() => refresh(false)).then(() => replay());
}

/** Stops sending. What is waiting stays on disk for this user's next sign-in. */
export function stopOutbox(): void {
  current = null;
  shown = [];
  clearInterval(timer);
  window.removeEventListener('online', onOnline);
  for (const listener of listeners) listener();
}

/** Throws away what one user has waiting: after they agreed to, or with the account. */
export function dropOutbox(userId: string): Promise<void> {
  if (!available()) return Promise.resolve();
  return serial(async () => {
    for (const entry of await entriesOf(userId)) await remove(entry.seq!);
    if (current?.userId === userId) await refresh();
  }).catch(() => undefined);
}

/** Throws away what anyone but `keep` has waiting: another user signed in on this browser. */
export function dropOtherOutboxes(keep: string | null): Promise<void> {
  if (!available()) return Promise.resolve();
  return serial(async () => {
    const all = (await run<OutboxEntry[]>('readonly', (store) => store.getAll())) ?? [];
    for (const entry of all) if (entry.userId !== keep) await remove(entry.seq!);
  }).catch(() => undefined);
}

/** Tries to send everything, and says how many changes are still not on the server. */
export async function unsentAfterTrying(userId: string): Promise<number> {
  if (current?.userId === userId) await replay();
  return (await serial(() => entriesOf(userId))).length;
}

/** Throws a single entry away, when the user gives up on a change that cannot be applied. */
export function discardEntry(noteId: string): Promise<void> {
  return resolveEntry(noteId, 'theirs');
}

/** For tests. */
export async function resetOutbox(): Promise<void> {
  stopOutbox();
  await dropOtherOutboxes(null);
}
