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
  mockFetch({
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
  return { now: () => current };
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
});
