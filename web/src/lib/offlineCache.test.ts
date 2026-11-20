import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { note, user } from '../test/fixtures';
import { seedOfflineCache } from '../test/offline';
import { isKept, keepOffline, MAX_AGE_MS, readRecord, tokenUserId, withinSize, writeRecord } from './offlineCache';

const query = (queryKey: unknown[], status = 'success') =>
  ({ queryKey, state: { status } }) as unknown as Parameters<typeof isKept>[0];

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

  it('stays within its size, leaving out what was loaded longest ago', () => {
    const big = (id: string, at: number) => ({
      queryKey: ['note', id],
      queryHash: id,
      state: { data: 'x'.repeat(400), dataUpdatedAt: at, status: 'success' },
    });
    const client = {
      timestamp: 1,
      buster: 'v1',
      clientState: { mutations: [], queries: [big('old', 1), big('new', 3), big('mid', 2)] },
    } as unknown as Parameters<typeof withinSize>[0];
    expect(withinSize(client, 1200).clientState.queries.map((q) => q.queryKey[1])).toEqual(['new', 'mid']);
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

  it('throws away a copy past its age instead of showing it', async () => {
    const seeded = await seedOfflineCache(user);
    const record = await readRecord(user.id);
    await writeRecord({ ...record!, client: { ...record!.client, timestamp: Date.now() - MAX_AGE_MS - 1 } });
    const client = new QueryClient();
    (await keepOffline(client, user)).stop();
    expect(client.getQueryData(['note', seeded.id])).toBeUndefined();
    expect(await readRecord(user.id)).toBeUndefined();
  });

  it('does not put a copy back for a user who is no longer wanted', async () => {
    await seedOfflineCache(user);
    const client = new QueryClient();
    (await keepOffline(client, user, () => false)).stop();
    expect(client.getQueryData(['note', 'n1'])).toBeUndefined();
  });
});
