import { onlineManager, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { MAX_AGE_MS } from './lib/offlineCache';

export function createQueryClient(): QueryClient {
  // TanStack Query takes itself to be online until it hears otherwise. A tab
  // opened without a connection has to say so, or every query would first
  // fail and retry instead of waiting, showing what is kept, for the network.
  if (typeof navigator !== 'undefined') onlineManager.setOnline(navigator.onLine);
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // As long as the copy kept for reading offline (lib/offlineCache.ts):
        // a query that is dropped from memory is dropped from that copy too.
        gcTime: MAX_AGE_MS,
        refetchOnWindowFocus: false,
        // Retrying a 404 or a validation error will not help.
        retry: (failureCount, error) =>
          failureCount < 2 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
}
