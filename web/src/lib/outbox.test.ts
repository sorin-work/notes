import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { Note } from '../api/types';
import { note, user } from '../test/fixtures';
import { mockFetch } from '../test/render';
import {
  createOffline,
  dropOtherOutboxes,
  outboxEntryFor,
  queueText,
  replay,
  resolveEntry,
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
    expect(outboxEntryFor('n1')).toMatchObject({ state: 'stuck', problem: 'This note is in the trash.' });
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

  it('belongs to one user: another user signing in here removes it', async () => {
    offline();
    await startOutbox(user.id, new QueryClient());
    await queueText(user.id, 'n1', { title: 'Plan', content: 'Mine' }, 3);
    await dropOtherOutboxes('someone-else');
    expect(await unsentAfterTrying(user.id)).toBe(0);
  });
});
