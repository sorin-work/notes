import type { QueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError, getToken } from '../api/client';
import { createNote, getNote, staleNote, updateNote } from '../api/notes';
import type { Note } from '../api/types';
import { tokenUserId } from './offlineCache';
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

/** Why an entry is stuck: the note is gone or not shared any more, it is in the trash, or the server refused it otherwise. */
export type StuckReason = 'gone' | 'trash' | 'refused';

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
  /** Goes up with every change, so a send can tell whether the entry changed while it was on its way. */
  version: number;
  state: EntryState;
  /** For a conflict: the note as the server had it. */
  theirs?: Note;
  /** For an entry that is stuck: why, in words and as a kind. */
  problem?: string;
  reason?: StuckReason;
  /** Failed sends in a row, and when to try again (ms since the epoch). */
  attempts?: number;
  nextTryAt?: number;
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

// Locks -----------------------------------------------------------------------

// Two locks per user, shared by all tabs through Web Locks. The data lock is
// held for every read-modify-write of the entries, and only briefly: never
// while a request is on its way. The send lock is held for a whole round of
// sending, so one tab sends at a time. Without Web Locks (old browsers, tests)
// a chain in this tab stands in for both.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

const webLocks = () => (typeof navigator !== 'undefined' ? navigator.locks : undefined);

function locked<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  return locks ? (locks.request(`notes-outbox-data-${userId}`, work) as Promise<T>) : serial(work);
}

let sendingHere: Promise<unknown> = Promise.resolve();
function sendLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (locks) return locks.request(`notes-outbox-send-${userId}`, work) as Promise<T>;
  const next = sendingHere.then(work, work);
  sendingHere = next.catch(() => undefined);
  return next;
}

// What the page sees -----------------------------------------------------------

let current: { userId: string; queryClient: QueryClient } | null = null;
let shown: OutboxEntry[] = [];
const listeners = new Set<() => void>();
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('notes-outbox') : null;
/** The last revision sent per note, here or in another tab: a new entry is never older. */
const lastSent = new Map<string, number>();

async function refresh(tellOthers = true) {
  shown = current ? await entriesOf(current.userId) : [];
  for (const listener of listeners) listener();
  if (tellOthers) channel?.postMessage({ changed: true });
}

channel?.addEventListener('message', (event: MessageEvent) => {
  const data = event.data as { sent?: { noteId: string; revision: number } } | undefined;
  if (data?.sent) noteSent(data.sent.noteId, data.sent.revision);
  void refresh(false);
});

function noteSent(noteId: string, revision: number) {
  lastSent.set(noteId, Math.max(lastSent.get(noteId) ?? 0, revision));
}

export function useOutbox(): OutboxEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
  );
}

/** The entry new text of a note goes into: never a stuck one. */
const openEntry = (entries: OutboxEntry[], noteId: string) =>
  entries.find((entry) => entry.noteId === noteId && entry.state !== 'stuck') ?? null;

/** The entry that new text of this note joins, if there is one. A stuck entry never takes new text. */
export const openEntryFor = (noteId: string) => openEntry(shown, noteId);

/** What the note has waiting, preferring an entry that still takes text over a stuck one. */
export const outboxEntryFor = (noteId: string) =>
  openEntry(shown, noteId) ?? shown.find((entry) => entry.noteId === noteId) ?? null;

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

/**
 * Keeps the text of a note to be sent later. `baseRevision` is the revision
 * the editor last knew; the base used is read here, under the lock, and is
 * never older than what was sent last, so text typed while a send was on its
 * way does not conflict with itself.
 */
export function queueText(
  userId: string,
  noteId: string,
  text: { title: string; content: string },
  baseRevision: number,
  maybeSent: { title: string; content: string }[] = [],
): Promise<void> {
  return locked(userId, async () => {
    const entry = openEntry(await entriesOf(userId), noteId);
    const sent = maybeSent.map(({ title, content }) => ({ title, content }));
    const at = new Date().toISOString();
    if (entry) {
      await put({
        ...entry,
        ...text,
        maybeSent: [...entry.maybeSent, ...sent].slice(-10),
        version: (entry.version ?? 0) + 1,
        at,
      });
    } else {
      await put({
        userId,
        noteId,
        kind: 'text',
        ...text,
        baseRevision: Math.max(baseRevision, lastSent.get(noteId) ?? 0),
        maybeSent: sent,
        version: 1,
        state: 'waiting',
        at,
      });
    }
    await refresh();
  }).then(() => void replay());
}

/** Makes a note without a connection: an id from the browser, and the note as it will be once sent. */
export async function createOffline(
  userId: string,
  start: { notebookId?: string | null; title?: string; content?: string },
): Promise<Note> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await locked(userId, async () => {
    await put({
      userId,
      noteId: id,
      kind: 'create',
      title: start.title ?? '',
      content: start.content ?? '',
      notebookId: start.notebookId ?? null,
      baseRevision: 0,
      maybeSent: [],
      version: 1,
      state: 'waiting',
      at: now,
    });
    await refresh();
  });
  return {
    id,
    title: start.title || 'Untitled',
    content: start.content ?? '',
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

/** A server that has a problem is asked again later, waiting longer each time, up to ten minutes. */
export function backoff(attempts: number): number {
  return Math.min(10 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

/** A note that is gone or in the trash is looked at again now and then, in case it comes back. */
const STUCK_RETRY_MS = 5 * 60_000;

/**
 * What happened to one entry. `stop` ends the round: the server cannot be
 * reached, or the session is not this user's any more.
 */
type Outcome =
  { kind: 'sent'; note: Note } | { kind: 'stop'; entry?: OutboxEntry } | { kind: 'kept'; entry: OutboxEntry };

/** Never sends one user's change with another user's token: another tab may have signed in as someone else. */
const sessionIs = (userId: string) => tokenUserId(getToken()) === userId;

function failed(entry: OutboxEntry, error: unknown, now: number): Outcome {
  const text = { title: entry.title, content: entry.content };
  if (unreachable(error)) {
    // It may have arrived all the same. If it did, the next round finds this text on the server.
    return { kind: 'stop', entry: { ...entry, maybeSent: [...entry.maybeSent, text].slice(-10) } };
  }
  if (!(error instanceof ApiError)) throw error;
  if (error.status === 401) return { kind: 'stop' };
  const attempts = (entry.attempts ?? 0) + 1;
  if (error.status >= 500 || error.status === 429) {
    return { kind: 'kept', entry: { ...entry, state: 'waiting', attempts, nextTryAt: now + backoff(attempts) } };
  }
  const reason: StuckReason =
    error.status === 404 || error.status === 403 ? 'gone' : error.message.includes('trash') ? 'trash' : 'refused';
  const problem =
    reason === 'gone'
      ? 'The note is gone, or not shared with you any more.'
      : reason === 'trash'
        ? 'The note is in the trash. Restore it and the change is sent.'
        : error.message;
  return {
    kind: 'kept',
    entry: { ...entry, state: 'stuck', reason, problem, attempts, nextTryAt: now + STUCK_RETRY_MS },
  };
}

async function send(entry: OutboxEntry, now: number): Promise<Outcome> {
  const text = { title: entry.title, content: entry.content };
  try {
    if (!sessionIs(entry.userId)) return { kind: 'stop' };
    if (entry.kind === 'create') {
      try {
        return { kind: 'sent', note: await createNote({ id: entry.noteId, ...text, notebookId: entry.notebookId }) };
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 409)) throw error;
        // The id is taken. If the note is ours, an earlier create went through
        // and its answer got lost. A network failure here says nothing either way.
        if (!sessionIs(entry.userId)) return { kind: 'stop' };
        let ours: Note | null;
        try {
          ours = await getNote(entry.noteId);
        } catch (lookup) {
          if (lookup instanceof ApiError && lookup.status === 404) ours = null;
          else throw lookup;
        }
        if (!ours) {
          return {
            kind: 'kept',
            entry: {
              ...entry,
              state: 'stuck',
              reason: 'refused',
              problem: 'The id made for this note is taken.',
              nextTryAt: now + STUCK_RETRY_MS,
            },
          };
        }
        if (sameText(ours, text)) return { kind: 'sent', note: ours };
        // Created with an earlier text of this entry, and untouched since: send the newer text on top.
        if (ours.revision === 0 && entry.maybeSent.some((sent) => sameText(ours, sent))) {
          return send({ ...entry, kind: 'text', baseRevision: ours.revision }, now);
        }
        // Changed somewhere else since it was made: the usual question.
        return { kind: 'kept', entry: { ...entry, kind: 'text', state: 'conflict', theirs: ours } };
      }
    }
    for (let rebased = 0; ; rebased++) {
      if (!sessionIs(entry.userId)) return { kind: 'stop' };
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
    return failed(entry, error, now);
  }
}

/**
 * Puts the outcome of a send back, unless the entry changed while it was on
 * its way. Then the newer text stays: on the revision the answer names when
 * the send went through, still waiting otherwise.
 */
async function settle(sent: OutboxEntry, outcome: Outcome): Promise<Note | null> {
  const stored = (await entriesOf(sent.userId)).find((entry) => entry.seq === sent.seq);
  if (!stored) return outcome.kind === 'sent' ? outcome.note : null;
  const changed = (stored.version ?? 0) !== (sent.version ?? 0);
  if (outcome.kind === 'sent') {
    noteSent(outcome.note.id, outcome.note.revision);
    if (!changed) await remove(sent.seq!);
    else {
      await put({
        ...stored,
        kind: 'text',
        baseRevision: outcome.note.revision,
        keepVersion: undefined,
        maybeSent: [],
        state: 'waiting',
        attempts: 0,
        nextTryAt: undefined,
      });
    }
    return outcome.note;
  }
  const next = outcome.entry;
  if (!next) return null;
  await put(
    changed ? { ...stored, ...pick(next), maybeSent: [...stored.maybeSent, ...next.maybeSent].slice(-10) } : next,
  );
  return null;
}

/** What a send learnt about an entry, without its text, which may be older than what is stored now. */
function pick(entry: OutboxEntry): Partial<OutboxEntry> {
  const { state, theirs, problem, reason, attempts, nextTryAt, kind, baseRevision } = entry;
  return { state, theirs, problem, reason, attempts, nextTryAt, kind, baseRevision };
}

let replaying: Promise<void> | null = null;

/**
 * Sends what is due, oldest first. Each entry goes through the normal create
 * or save, so a note changed elsewhere meanwhile raises the usual question
 * instead of being overwritten. Running it twice, in two tabs, or on a
 * connection that comes and goes, applies nothing twice. `all` also sends
 * what is waiting out a backoff ("Send now").
 */
export function replay(all = false): Promise<void> {
  if (!current) return Promise.resolve();
  replaying ??= (async () => {
    const { userId, queryClient } = current!;
    await sendLock(userId, async () => {
      for (;;) {
        if (current?.userId !== userId || !sessionIs(userId)) break;
        const now = Date.now();
        const due = (await locked(userId, () => entriesOf(userId))).find(
          (entry) => entry.state !== 'conflict' && (all || !entry.nextTryAt || entry.nextTryAt <= now),
        );
        if (!due) break;
        const outcome = await send(due, now);
        const note = await locked(userId, () => settle(due, outcome));
        if (note) {
          queryClient.setQueryData(['note', note.id], note);
          void queryClient.invalidateQueries({ queryKey: ['notes'] });
          channel?.postMessage({ sent: { noteId: note.id, revision: note.revision } });
          for (const listener of sentListeners) listener(note);
        }
        if (outcome.kind === 'stop') break;
        // An entry that is not due any more is skipped by the next pass, so the loop ends.
        if (outcome.kind === 'kept' && outcome.entry.state === 'waiting' && !outcome.entry.nextTryAt) break;
        if (all && outcome.kind === 'kept') all = false;
      }
      await refresh();
    });
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
  return locked(userId, async () => {
    const entry = (await entriesOf(userId)).find((item) => item.noteId === noteId && item.state === 'conflict');
    if (!entry) return;
    if (choice === 'theirs') await remove(entry.seq!);
    else {
      await put({
        ...entry,
        kind: 'text',
        baseRevision: entry.theirs?.revision ?? entry.baseRevision,
        keepVersion: choice === 'both',
        version: (entry.version ?? 0) + 1,
        state: 'waiting',
        theirs: undefined,
        problem: undefined,
      });
    }
    await refresh();
  }).then(() => void replay());
}

/** Gives up one stuck change. */
export function discardEntry(seq: number): Promise<void> {
  if (!current) return Promise.resolve();
  const { userId } = current;
  return locked(userId, async () => {
    await remove(seq);
    await refresh();
  });
}

/**
 * Keeps the text of a stuck change as a new note of its own, for a note that
 * is gone or in the trash. The stuck entry goes; the new note is sent as usual.
 */
export async function saveAsNewNote(seq: number): Promise<string | null> {
  if (!current) return null;
  const { userId } = current;
  const entry = (await locked(userId, () => entriesOf(userId))).find((item) => item.seq === seq);
  if (!entry) return null;
  const made = await createOffline(userId, { title: entry.title, content: entry.content });
  await discardEntry(seq);
  void replay();
  return made.id;
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
    if (shown.some((entry) => entry.state !== 'conflict')) void replay();
  }, 30_000);
  // What is waiting is known before anything is shown, so that an editor opens on it. Sending can follow.
  return locked(userId, () => refresh(false)).then(() => void replay());
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
  return locked(userId, async () => {
    for (const entry of await entriesOf(userId)) await remove(entry.seq!);
    if (current?.userId === userId) await refresh();
  }).catch(() => undefined);
}

/** How many changes other users than `userId` have waiting on this browser. */
export async function unsentOfOthers(userId: string): Promise<number> {
  if (!available()) return 0;
  const all = (await run<OutboxEntry[]>('readonly', (store) => store.getAll()).catch(() => [])) ?? [];
  return all.filter((entry) => entry.userId !== userId).length;
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
  if (current?.userId === userId) await replay(true);
  return (await locked(userId, () => entriesOf(userId))).length;
}

/** For tests: starts from nothing, whatever an earlier test left running. */
export async function resetOutbox(): Promise<void> {
  stopOutbox();
  chain = Promise.resolve();
  sendingHere = Promise.resolve();
  replaying = null;
  lastSent.clear();
  await dropOtherOutboxes(null);
}
