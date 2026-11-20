import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { clearNotices } from '../lib/notices';
import { dropOtherOfflineCaches } from '../lib/offlineCache';

// The default of one second is too tight on busy CI machines.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  clearNotices();
  return dropOtherOfflineCaches(null);
});
