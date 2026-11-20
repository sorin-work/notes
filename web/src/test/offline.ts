import type { User } from '../api/types';
import { offlineCacheUsers, writeRecord } from '../lib/offlineCache';
import { note } from './fixtures';

/** Puts a kept copy on "disk" for `user`, holding one note, as if the user had opened it before. */
export async function seedOfflineCache(user: User, noteId = 'n1') {
  const kept = note({ id: noteId, title: `Kept for ${user.name}` });
  await writeRecord({
    userId: user.id,
    user,
    client: {
      timestamp: Date.now(),
      buster: 'v1',
      clientState: {
        mutations: [],
        queries: [
          {
            queryKey: ['note', noteId],
            queryHash: JSON.stringify(['note', noteId]),
            dehydratedAt: Date.now(),
            state: {
              data: kept,
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle',
            },
          },
        ],
      },
    },
  });
  return kept;
}

export const keptUsers = offlineCacheUsers;
