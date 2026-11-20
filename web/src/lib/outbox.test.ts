import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setToken } from '../api/client';
import type { Note } from '../api/types';
import { note, user, userToken } from '../test/fixtures';
import { mockFetch } from '../test/render';
import {
  createOffline,
  dropOtherOutboxes,
  openEntryFor,
  outboxEntryFor,
  queueText,
  replay,
  resolveEntry,
  saveAsNewNote,
  startOutbox,
  stopOutbox,
  unsentAfterTrying,
} from './outbox';

const offline = () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
const conflict = (current: Note) => ({
  status: 409,
  body: { statusCode: 409, error: 'Conflict', message: 'changed', code: 'stale_revision', note: current },
});

/** A server holding one note, which takes a PATCH only on its current revision, like the API. */
function server(start: Note) {
  let current = start;
  let loseNextAnswer = false;
  const calls = mockFetch({
    'GET /api/notes/n1': () => ({ body: current }),
    'PATCH /api/notes/n1': ({ body }) => {
      const changes = body as { title: string; content: string; revision?: number };
      if (changes.revision !== undefined && changes.revision !== current.revision) return conflict(current);
      current = { ...current, title: changes.title, content: changes.content, revision: current.revision + 1 };
      if (loseNextAnswer) {
        loseNextAnswer = false;
        throw new TypeError('Failed to fetch');
      }
      return { body: current };
    },
  });
  return {
    calls,
    now: () => current,
    changeElsewhere: (content: string) => (current = { ...current, content, revision: current.revision + 1 }),
    loseNextAnswer: () => (loseNextAnswer = true),
  };
}

describe('the outbox', () => {
  beforeEach(() => setToken(userToken));

  it('keeps one entry per note across a reload, and sends it on its base revision', async () => {
    const client = new QueryClient();
    offline();
    await startOutbox(user.id, client);
    await queueText(user.id, 'n1', { title: 'Plan', content: 'one' }, 3);
    await queueText(user.id, 'n1', { title: 'Plan', content: 'one two' }, 4);
    expect(outboxEntryFor('n1')).toMatchObject({ content: 'one two', baseRevision: 3, state: 'waiting' });

    // The tab is reloaded: nothing in memory, the entry still on disk.
    stopOutbox();
    expect(outboxEntryFor('n1')).toBeNull();
    const api = server(note({ id: 'n1', revision: 3 }));
    await startOutbox(user.id, client);
    await replay();
    const patches = api.calls.filter((call) => call.method === 'PATCH');
    expect(patches.map((call) => call.body)).toEqual([{ title: 'Plan', content: 'one two', revision: 3 }]);
    expect(outboxEntryFor('n1')).toBeNull();
    expect(client.getQueryData<Note>(['note', 'n1'])?.content).toBe('one two');
  });

  it('applies nothing twice when the answer is lost and the connection flaps', async () => {
    const api = server(note({ id: 'n1', revision: 3 }));
    await startOutbox(user.id, new QueryClient());
    api.loseNextAnswer();
    await queueText(user.id, 'n1', { title: 'Plan', content: 'typed offline' }, 3);
    await replay();
    // Written, but this tab does not know. It is still waiting.
    expect(api.now()).toMatchObject({ content: 'typed offline', revision: 4 });
    expect(outboxEntryFor('n1')).not.toBeNull();
    await Promise.all([replay(), replay()]);
    expect(api.now().revision).toBe(4);
    expect(outboxEntryFor('n1')).toBeNull();
  });

  it('asks rather than overwrites when the note changed elsewhere, and keeps the change until told', async () => {
    const api = server(note({ id: 'n1', revision: 3 }));
    await startOutbox(user.id, new QueryClient());
    api.changeElsewhere('Changed on the phone');
    offline();
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Mine' }, 3);
    vi.unstubAllGlobals();
    const back = server(api.now());
    await replay();
    expect(outboxEntryFor('n1')).toMatchObject({ state: 'conflict', theirs: { content: 'Changed on the phone' } });
    expect(back.now().content).toBe('Changed on the phone');
    // Reconnecting again does not push it through.
    await replay();
    expect(back.now().content).toBe('Changed on the phone');

    await resolveEntry('n1', 'both');
    await replay();
    expect(back.now().content).toBe('Mine');
    expect(back.calls.findLast((call) => call.method === 'PATCH')?.body).toMatchObject({
      revision: 4,
      keepVersion: true,
    });
    expect(outboxEntryFor('n1')).toBeNull();
  });

  it('drops a change only when told to take theirs', async () => {
    const api = server(note({ id: 'n1', revision: 5 }));
    await startOutbox(user.id, new QueryClient());
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Mine' }, 3);
    await replay();
    expect(outboxEntryFor('n1')?.state).toBe('conflict');
    await resolveEntry('n1', 'theirs');
    expect(outboxEntryFor('n1')).toBeNull();
    expect(api.now().revision).toBe(5);
  });

  it('keeps and shows a change the server will not take, such as one to a note in the trash', async () => {
    mockFetch({
      'PATCH /api/notes/n1': { status: 409, body: { statusCode: 409, message: 'This note is in the trash.' } },
    });
    await startOutbox(user.id, new QueryClient());
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Mine' }, 3);
    await replay();
    expect(outboxEntryFor('n1')).toMatchObject({
      state: 'stuck',
      reason: 'trash',
      problem: 'The note is in the trash. Restore it and the change is sent.',
    });
    expect(await unsentAfterTrying(user.id)).toBe(1);
  });

  it('creates a note made offline under its own id once, also when the answer was lost', async () => {
    offline();
    const client = new QueryClient();
    await startOutbox(user.id, client);
    const made = await createOffline(user.id, { notebookId: null });
    await queueText(user.id, made.id, { title: 'On the train', content: 'x' }, 0);
    expect(outboxEntryFor(made.id)).toMatchObject({ kind: 'create', title: 'On the train' });

    let created: Note | null = null;
    const calls = mockFetch({
      'POST /api/notes': ({ body }) => {
        if (created) return { status: 409, body: { statusCode: 409, code: 'note_exists' } };
        created = note({ ...(body as Partial<Note>), revision: 0 });
        throw new TypeError('Failed to fetch');
      },
      [`GET /api/notes/${made.id}`]: () => (created ? { body: created } : { status: 404, body: {} }),
    });
    await replay();
    await replay();
    expect(calls.filter((call) => call.method === 'POST').map((call) => (call.body as { id: string }).id)).toEqual([
      made.id,
      made.id,
    ]);
    expect(created).toMatchObject({ id: made.id, title: 'On the train' });
    expect(outboxEntryFor(made.id)).toBeNull();
  });

  it('keeps text written while a send was on its way, on the revision that send got back', async () => {
    let current = note({ id: 'n1', revision: 3 });
    let answer: (() => void) | null = null;
    const calls = mockFetch({
      'PATCH /api/notes/n1': ({ body }) =>
        new Promise((resolve) => {
          const changes = body as { title: string; content: string; revision: number };
          const apply = () => {
            if (changes.revision !== current.revision) return resolve(conflict(current));
            current = { ...current, title: changes.title, content: changes.content, revision: current.revision + 1 };
            resolve({ body: current });
          };
          // The first send hangs until the test lets it answer.
          if (!answer && changes.content === 'T1') answer = apply;
          else apply();
        }),
    });
    await startOutbox(user.id, new QueryClient());
    void queueText(user.id, 'n1', { title: 'Plan', content: 'T1' }, 3);
    await vi.waitFor(() => expect(answer).not.toBeNull());
    // Another tab, or this editor, writes T2 while T1 is on its way, still on the old revision.
    await queueText(user.id, 'n1', { title: 'Plan', content: 'T2' }, 3);
    answer!();
    await vi.waitFor(() => expect(current.content).toBe('T2'));
    await replay();
    expect(outboxEntryFor('n1')).toBeNull();
    // T2 went on top of the revision T1 got, so no conflict with its own text.
    expect(calls.filter((call) => call.method === 'PATCH').map((call) => call.body)).toEqual([
      { title: 'Plan', content: 'T1', revision: 3 },
      { title: 'Plan', content: 'T2', revision: 4 },
    ]);

    // Text queued after the entry went is based on what was sent, not on what the editor last saw.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await queueText(user.id, 'n1', { title: 'Plan', content: 'T3' }, 3);
    expect(outboxEntryFor('n1')?.baseRevision).toBe(5);
  });

  it('asks when a note made offline was changed elsewhere after its create went through unanswered', async () => {
    const created = note({ id: 'c1', title: 'On the train', content: 'Changed on the phone', revision: 1 });
    offline();
    await startOutbox(user.id, new QueryClient());
    const made = await createOffline(user.id, { title: 'On the train', content: 'x' });
    mockFetch({
      'POST /api/notes': { status: 409, body: { statusCode: 409, code: 'note_exists' } },
      [`GET /api/notes/${made.id}`]: { body: { ...created, id: made.id } },
    });
    await replay();
    expect(outboxEntryFor(made.id)).toMatchObject({ state: 'conflict', theirs: { content: 'Changed on the phone' } });
  });

  it('does not take a network failure while checking a lost create for a taken id', async () => {
    offline();
    await startOutbox(user.id, new QueryClient());
    const made = await createOffline(user.id, { title: 'On the train' });
    mockFetch({
      'POST /api/notes': { status: 409, body: { statusCode: 409, code: 'note_exists' } },
      [`GET /api/notes/${made.id}`]: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await replay();
    expect(outboxEntryFor(made.id)).toMatchObject({ state: 'waiting' });
  });

  it('tries a server error again later, and keeps a change to a note that is gone, to save as a new note', async () => {
    mockFetch({ 'PATCH /api/notes/n1': { status: 503, body: { message: 'Down for a moment' } } });
    await startOutbox(user.id, new QueryClient());
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Mine' }, 3);
    await replay();
    const waiting = outboxEntryFor('n1');
    expect(waiting).toMatchObject({ state: 'waiting', attempts: 1 });
    expect(waiting!.nextTryAt).toBeGreaterThan(Date.now());

    const calls = mockFetch({
      'PATCH /api/notes/n1': { status: 404, body: { statusCode: 404, message: 'Note not found' } },
      'POST /api/notes': ({ body }) => ({ status: 201, body: note({ ...(body as Partial<Note>), revision: 0 }) }),
    });
    await replay(true);
    const stuck = outboxEntryFor('n1');
    expect(stuck).toMatchObject({ state: 'stuck', reason: 'gone' });
    // New text of the note never goes into the stuck entry.
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Later' }, 3);
    expect(openEntryFor('n1')?.content).toBe('Later');
    expect(outboxEntryFor('n1')?.state).not.toBe('stuck');

    const id = await saveAsNewNote(stuck!.seq!);
    await replay();
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ id, title: 'Plan', content: 'Mine' });
  });

  it('picks a change up again once its note is restored from the trash', async () => {
    let inTrash = true;
    mockFetch({
      'PATCH /api/notes/n1': ({ body }) =>
        inTrash
          ? {
              status: 409,
              body: { statusCode: 409, message: 'This note is in the trash. Restore it before changing it.' },
            }
          : { body: note({ ...(body as Partial<Note>), id: 'n1', revision: 4 }) },
    });
    await startOutbox(user.id, new QueryClient());
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Mine' }, 3);
    await replay();
    expect(outboxEntryFor('n1')?.reason).toBe('trash');
    inTrash = false;
    await replay(true);
    expect(outboxEntryFor('n1')).toBeNull();
  });

  it('sends nothing while the token is another user’s, as after a sign-in in another tab', async () => {
    const calls = mockFetch({ 'PATCH /api/notes/n1': { body: note() } });
    await startOutbox(user.id, new QueryClient());
    setToken(`h.${btoa(JSON.stringify({ sub: 'someone-else' }))}.s`);
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Mine' }, 3);
    await replay(true);
    expect(calls.filter((call) => call.method !== 'GET')).toEqual([]);
    expect(outboxEntryFor('n1')).not.toBeNull();
  });

  it('belongs to one user: another user signing in here removes it', async () => {
    offline();
    await startOutbox(user.id, new QueryClient());
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Mine' }, 3);
    await dropOtherOutboxes('someone-else');
    expect(await unsentAfterTrying(user.id)).toBe(0);
  });
});
