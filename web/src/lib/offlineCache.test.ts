import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { note, user } from '../test/fixtures';
import { seedOfflineCache } from '../test/offline';
import { ApiError, setToken } from '../api/client';
import { forDisk, isKept, keepOffline, MAX_AGE_MS, readRecord, tokenUserId, writeRecord } from './offlineCache';

const query = (queryKey: unknown[], status = 'success') =>
  ({ queryKey, state: { status, data: status === 'success' ? {} : undefined } }) as unknown as Parameters<
    typeof isKept
  >[0];

describe('what is kept on disk', () => {
  it('is notes, note lists, notebooks, tags and links, and nothing else', () => {
    for (const key of [
      ['note', 'n1'],
      ['notes', { view: 'pinned' }],
      ['notes', 'templates'],
      ['notebooks'],
      ['tags'],
      ['links', 'n1'],
    ]) {
      expect(isKept(query(key))).toBe(true);
    }
    for (const key of [
      ['notes', 'search', 'atlas', null, null],
      ['api-tokens'],
      ['backlinks', 'n1'],
      ['versions', 'n1'],
      ['version', 'n1', 'v1'],
      ['titles', 'At'],
      ['trash'],
      ['resolve', 'atlas'],
      ['password-reset-enabled'],
    ]) {
      expect(isKept(query(key))).toBe(false);
    }
    expect(isKept(query(['note', 'n1'], 'error'))).toBe(false);
  });

  it('keeps a note whose refetch failed for want of a connection or a server, not one that is gone', () => {
    const failed = (error: unknown) =>
      ({ queryKey: ['note', 'n1'], state: { status: 'error', data: { id: 'n1' }, error } }) as unknown as Parameters<
        typeof isKept
      >[0];
    expect(isKept(failed(new ApiError(0, 'Could not reach the server.')))).toBe(true);
    expect(isKept(failed(new ApiError(502, 'Bad gateway')))).toBe(true);
    expect(isKept(failed(new ApiError(404, 'Note not found')))).toBe(false);
    expect(isKept(failed(new ApiError(403, 'Forbidden')))).toBe(false);
  });
});

describe('forDisk', () => {
  const at = (id: string, dataUpdatedAt: number, status = 'success') => ({
    queryKey: ['note', id],
    queryHash: id,
    state: { data: 'x'.repeat(400), dataUpdatedAt, status, error: status === 'error' ? new Error('x') : null },
  });
  const client = (queries: ReturnType<typeof at>[]) =>
    ({ timestamp: 1, buster: 'v1', clientState: { mutations: [], queries } }) as unknown as Parameters<
      typeof forDisk
    >[0];
  const now = 10 * MAX_AGE_MS;

  it('stays within its size, leaving out what was loaded longest ago', () => {
    const kept = forDisk(client([at('old', now - 3), at('new', now - 1), at('mid', now - 2)]), 1200, now);
    expect(kept.clientState.queries.map((q) => q.queryKey[1])).toEqual(['new', 'mid']);
  });

  it('leaves out data fetched more than seven days ago, however recently the copy was written', () => {
    const kept = forDisk(client([at('stale', now - MAX_AGE_MS - 1), at('fresh', now - 1, 'error')]), 10_000, now);
    expect(kept.clientState.queries.map((q) => q.queryKey[1])).toEqual(['fresh']);
    // A failed refetch is kept as the data it had.
    expect(kept.clientState.queries[0]?.state).toMatchObject({ status: 'success', error: null });
  });

  it('measures each query once, so a large cache is cut quickly', () => {
    const many = Array.from({ length: 5000 }, (_, i) => at(`n${i}`, now - i));
    const started = performance.now();
    const kept = forDisk(client(many), 100_000, now);
    expect(performance.now() - started).toBeLessThan(500);
    expect(kept.clientState.queries.length).toBeGreaterThan(100);
    expect(kept.clientState.queries.length).toBeLessThan(5000);
  });
});

describe('tokenUserId', () => {
  it('reads the user id from a login token, and nothing from anything else', () => {
    expect(tokenUserId(`h.${btoa(JSON.stringify({ sub: 'u1' }))}.s`)).toBe('u1');
    expect(tokenUserId('not-a-token')).toBeNull();
    expect(tokenUserId('h.%%%.s')).toBeNull();
    expect(tokenUserId(null)).toBeNull();
  });
});

describe('keepOffline', () => {
  it('reads back what was kept, then writes changes, leaving out what may not be kept', async () => {
    setToken(`h.${btoa(JSON.stringify({ sub: user.id }))}.s`);
    await seedOfflineCache(user);
    const client = new QueryClient();
    const kept = await keepOffline(client, user);
    expect(client.getQueryData<{ title: string }>(['note', 'n1'])?.title).toBe('Kept for Demo User');

    client.setQueryData(['note', 'n2'], note({ id: 'n2', title: 'Opened later' }));
    client.setQueryData(['api-tokens'], [{ id: 't1', name: 'secret script' }]);
    client.setQueryData(['notes', 'search', 'atlas', null, null], { pages: [] });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    kept.stop();

    const record = await readRecord(user.id);
    const keys = record?.client.clientState.queries.map((q) => q.queryKey) ?? [];
    expect(keys).toEqual(
      expect.arrayContaining([
        ['note', 'n1'],
        ['note', 'n2'],
      ]),
    );
    expect(JSON.stringify(record)).not.toContain('secret script');
    expect(keys.some((key) => key[1] === 'search')).toBe(false);
  });

  it('throws away what was fetched more than seven days ago instead of showing it', async () => {
    const seeded = await seedOfflineCache(user);
    const record = await readRecord(user.id);
    const [query] = record!.client.clientState.queries;
    const old = { ...query!, state: { ...query!.state, dataUpdatedAt: Date.now() - MAX_AGE_MS - 1 } };
    await writeRecord({
      ...record!,
      client: { ...record!.client, timestamp: Date.now(), clientState: { mutations: [], queries: [old] } },
    });
    const client = new QueryClient();
    (await keepOffline(client, user)).stop();
    expect(client.getQueryData(['note', seeded.id])).toBeUndefined();
    expect(await readRecord(user.id)).toBeUndefined();
  });

  it('writes nothing while the token names someone else, as after a sign-in in another tab', async () => {
    setToken(`h.${btoa(JSON.stringify({ sub: 'someone-else' }))}.s`);
    const client = new QueryClient();
    const kept = await keepOffline(client, user);
    client.setQueryData(['note', 'n9'], note({ id: 'n9' }));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    kept.stop();
    expect(await readRecord(user.id)).toBeUndefined();
  });

  it('does not put a copy back for a user who is no longer wanted', async () => {
    await seedOfflineCache(user);
    const client = new QueryClient();
    (await keepOffline(client, user, () => false)).stop();
    expect(client.getQueryData(['note', 'n1'])).toBeUndefined();
  });
});
