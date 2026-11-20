import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { setToken } from '../api/client';
import type { Note } from '../api/types';
import { note, user, userToken } from '../test/fixtures';
import { mockFetch } from '../test/render';
import * as A from './outbox';

/**
 * Two tabs of one browser: two copies of the outbox module, one IndexedDB,
 * one set of locks. The two scenarios the review of the outbox found.
 */
const offline = () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
function server(start: Note) {
  let current = start;
  const created: { content: string }[] = [];
  mockFetch({
    'POST /api/notes': ({ body }) => {
      created.push(body as { content: string });
      return { status: 201, body: { ...note(), ...(body as object), revision: 0 } };
    },
    'GET /api/notes/n1': () => ({ body: current }),
    'PATCH /api/notes/n1': ({ body }) => {
      const sent = body as { title: string; content: string; revision?: number };
      if (sent.revision !== undefined && sent.revision !== current.revision) {
        return { status: 409, body: { statusCode: 409, message: 'changed', code: 'stale_revision', note: current } };
      }
      current = { ...current, title: sent.title, content: sent.content, revision: current.revision + 1 };
      return { body: current };
    },
  });
  return { now: () => current, created };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
const base = { title: 'T', content: 'base' };

describe('two tabs offline on one note', () => {
  it('never lets one tab’s text replace the other’s: the second tab is asked', async () => {
    // @ts-expect-error a second copy of the module is a second tab
    const B: typeof A = await import('./outbox.ts?tab=b');
    setToken(userToken);
    offline();
    await A.startOutbox(user.id, new QueryClient());
    await B.startOutbox(user.id, new QueryClient());
    await A.queueText(user.id, 'n1', { title: 'T', content: 'base + foo from A' }, 5, [], base);
    await tick();
    expect(B.openEntryFor('n1')).not.toBeNull();

    // B's editor started from "base" and never saw A's text.
    const clash = B.queueText(user.id, 'n1', { title: 'T', content: 'base + bar from B' }, 5, [], base);
    await expect(clash).rejects.toBeInstanceOf(B.QueuedElsewhere);
    await clash.catch((error: InstanceType<typeof B.QueuedElsewhere>) =>
      expect(error.queued.content).toBe('base + foo from A'),
    );

    const s = server(note({ id: 'n1', ...base, revision: 5 }));
    await A.replay();
    await B.replay();
    await tick();
    expect(s.now()).toMatchObject({ content: 'base + foo from A', revision: 6 });
    B.stopOutbox();
  });

  it('never puts one tab’s change on a revision only the other tab saw: it meets a conflict', async () => {
    // @ts-expect-error a second tab
    const B: typeof A = await import('./outbox.ts?tab=c');
    setToken(userToken);
    offline();
    await A.startOutbox(user.id, new QueryClient());
    await B.startOutbox(user.id, new QueryClient());
    await A.queueText(user.id, 'n1', { title: 'T', content: 'base + foo from A' }, 5, [], base);
    const s = server(note({ id: 'n1', ...base, revision: 5 }));
    await A.replay();
    await tick();
    expect(B.openEntryFor('n1')).toBeNull();

    // B's editor is still on revision 5 and never saw A's text; its save cannot reach the server.
    offline();
    const bar = { title: 'T', content: 'base + bar from B' };
    await B.queueText(user.id, 'n1', bar, 5, [bar], base);
    expect(B.openEntryFor('n1')?.baseRevision).toBe(5);
    const back = server(s.now());
    await B.replay();
    await tick();
    expect(back.now()).toMatchObject({ content: 'base + foo from A', revision: 6 });
    expect(B.outboxEntryFor('n1')).toMatchObject({ state: 'conflict', content: 'base + bar from B' });
    B.stopOutbox();
  });

  /** What the editor does when the tab is left with that question open: this tab's text becomes a note of its own. */
  async function leaveWithQuestionOpen(tab: typeof A, mine: { title: string; content: string }) {
    await tab.createOffline(
      user.id,
      { title: `${mine.title} (kept when leaving)`, content: mine.content },
      'aaaaaaaa-1111-4111-8111-111111111111',
    );
  }

  it('loses nothing when the question is left open after the other tab sent its text', async () => {
    // @ts-expect-error a second tab
    const B: typeof A = await import('./outbox.ts?tab=d');
    setToken(userToken);
    offline();
    await A.startOutbox(user.id, new QueryClient());
    await B.startOutbox(user.id, new QueryClient());
    await A.queueText(user.id, 'n1', { title: 'T', content: 'foo from A' }, 5, [], base);
    await tick();
    const bar = { title: 'T', content: 'bar from B' };
    await expect(B.queueText(user.id, 'n1', bar, 5, [], base)).rejects.toBeInstanceOf(B.QueuedElsewhere);
    const s = server(note({ id: 'n1', ...base, revision: 5 }));
    await A.replay();
    await tick();
    await leaveWithQuestionOpen(B, bar);
    await B.replay();
    await A.replay();
    await tick();
    expect(s.now().content).toBe('foo from A');
    expect(s.created.map((body) => body.content)).toEqual(['bar from B']);
    expect(await B.unsentAfterTrying(user.id)).toBe(0);
    B.stopOutbox();
  });

  it('loses nothing when the question is left open while the other tab typed more', async () => {
    // @ts-expect-error a second tab
    const B: typeof A = await import('./outbox.ts?tab=e');
    setToken(userToken);
    offline();
    await A.startOutbox(user.id, new QueryClient());
    await B.startOutbox(user.id, new QueryClient());
    const foo = { title: 'T', content: 'foo from A' };
    await A.queueText(user.id, 'n1', foo, 5, [], base);
    await tick();
    const bar = { title: 'T', content: 'bar from B' };
    await expect(B.queueText(user.id, 'n1', bar, 5, [], base)).rejects.toBeInstanceOf(B.QueuedElsewhere);
    await A.queueText(user.id, 'n1', { title: 'T', content: 'foo from A + more from A' }, 5, [], foo);
    await tick();
    await leaveWithQuestionOpen(B, bar);
    const s = server(note({ id: 'n1', ...base, revision: 5 }));
    await A.replay();
    await tick();
    expect(s.now().content).toBe('foo from A + more from A');
    expect(s.created.map((body) => body.content)).toEqual(['bar from B']);
    B.stopOutbox();
  });

  it('makes one copy for "keep both", however often it is tried', async () => {
    offline();
    await A.startOutbox(user.id, new QueryClient());
    const id = 'bbbbbbbb-1111-4111-8111-111111111111';
    await A.createOffline(user.id, { title: 'T (from another tab)', content: 'foo' }, id);
    await A.createOffline(user.id, { title: 'T (from another tab)', content: 'foo' }, id);
    expect(A.outboxSnapshot().filter((entry) => entry.noteId === id)).toHaveLength(1);
  });
});
