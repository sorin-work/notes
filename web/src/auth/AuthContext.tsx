import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as authApi from '../api/auth';
import { ApiError, getToken, onTokenChangedElsewhere, setToken, setUnauthorizedHandler } from '../api/client';
import type { AuthResult, User } from '../api/types';
import { clearNotices } from '../lib/notices';
import { discardUnsavedWork, putUnsavedWorkAside } from '../lib/unsavedWork';
import {
  dropOfflineCache,
  dropOtherOfflineCaches,
  keepOffline,
  type OfflineCache,
  readRecord,
  tokenUserId,
} from '../lib/offlineCache';

/**
 * `offline`: there is a token, but the server cannot be reached and this
 * browser has nothing kept for the user, so there is nothing to show yet.
 */
type Status = 'loading' | 'signed-in' | 'signed-out' | 'offline';

interface AuthContextValue {
  status: Status;
  user: User | null;
  login(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  logout(): void;
  /** Shows a changed name or email without asking the API again. */
  updateUser(user: User): void;
  /** Swaps in the token the API hands out when it has ended the old one. */
  renewSession(result: AuthResult): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** A page load for a fresh start. Apart, so that tests can watch for it. */
export const page = { reload: () => window.location.reload() };
const reloadPage = () => page.reload();

const unreachable = (error: unknown) => error instanceof ApiError && error.status === 0;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>(() => (getToken() ? 'loading' : 'signed-out'));
  // Whose notes are being kept on disk right now, and the handle that stops it.
  const kept = useRef<{ userId: string; cache: Promise<OfflineCache> } | null>(null);

  // A function, so that TypeScript does not take the value read before an await for the one after it.
  const keptUser = useCallback(() => kept.current?.userId ?? null, []);

  const stopKeeping = useCallback(() => {
    const current = kept.current;
    kept.current = null;
    void current?.cache.then((cache) => cache.stop());
    return current?.userId ?? null;
  }, []);

  /** Starts keeping `who`'s notes and reads back what was kept. Anyone else's copy goes. */
  const startKeeping = useCallback(
    async (who: User) => {
      if (kept.current?.userId === who.id) return;
      stopKeeping();
      const entry = { userId: who.id } as { userId: string; cache: Promise<OfflineCache> };
      entry.cache = dropOtherOfflineCaches(who.id).then(() =>
        keepOffline(queryClient, who, () => kept.current === entry),
      );
      kept.current = entry;
      const cache = entry.cache;
      await cache;
    },
    [queryClient, stopKeeping],
  );

  // Goes up with every sign-out, so a sign-in that was still waiting knows it came too late.
  const generation = useRef(0);

  const logout = useCallback(() => {
    generation.current++;
    // The user whose notes are on disk: the one shown, or else the one the token names.
    const userId = stopKeeping() ?? tokenUserId(getToken());
    setToken(null);
    setUser(null);
    setStatus('signed-out');
    queryClient.clear();
    // The copy on disk goes as well, after any write that was already on its way.
    if (userId) void dropOfflineCache(userId);
    // Notices name notes. Whoever signs in next at this screen should not read them.
    clearNotices();
  }, [queryClient, stopKeeping]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Signing out in one tab signs out the others, cached notes included. A
  // tab that finds another user signed in under it lets go of everything of
  // the old one: its draft is put aside under that user, not saved as the
  // new one, and the page starts again for whoever is signed in now.
  useEffect(
    () =>
      onTokenChangedElsewhere((token) => {
        if (token === null) {
          logout();
          return;
        }
        const shown = keptUser();
        const now = tokenUserId(token);
        if (shown === null || now === null || now === shown) return;
        putUnsavedWorkAside();
        discardUnsavedWork();
        stopKeeping();
        generation.current++;
        setUser(null);
        setStatus('loading');
        queryClient.clear();
        clearNotices();
        reloadPage();
      }),
    [keptUser, logout, queryClient, stopKeeping],
  );

  // Who is signed in. Without a connection, the user kept with the notes on
  // this browser stands in until the server can be asked again.
  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    let waitingForNetwork = false;

    const ask = () => {
      authApi
        .me()
        .then(async (me) => {
          if (cancelled) return;
          await startKeeping(me);
          if (cancelled || keptUser() !== me.id) return;
          setUser(me);
          setStatus('signed-in');
        })
        .catch(async (error: unknown) => {
          if (cancelled) return;
          if (!unreachable(error)) {
            logout();
            return;
          }
          if (!waitingForNetwork) {
            waitingForNetwork = true;
            window.addEventListener('online', retry);
          }
          const known = kept.current ? null : await readRecord(tokenUserId(getToken()) ?? '');
          if (cancelled || kept.current) return;
          if (known) {
            await startKeeping(known.user);
            if (cancelled || keptUser() !== known.user.id) return;
            setUser(known.user);
            setStatus('signed-in');
          } else {
            setStatus('offline');
          }
        });
    };
    const retry = () => {
      if (getToken()) ask();
    };
    ask();
    return () => {
      cancelled = true;
      window.removeEventListener('online', retry);
    };
  }, [keptUser, logout, startKeeping]);

  const signedIn = useCallback(
    async (result: AuthResult) => {
      const started = generation.current;
      setToken(result.token);
      await startKeeping(result.user);
      // Signed out while the kept copy was read: this sign-in is over too.
      if (generation.current !== started) return;
      setUser(result.user);
      setStatus('signed-in');
    },
    [startKeeping],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: async (email, password) => signedIn(await authApi.login(email, password)),
      register: async (name, email, password) => signedIn(await authApi.register(name, email, password)),
      logout,
      updateUser: setUser,
      renewSession: (result) => void signedIn(result),
    }),
    [status, user, signedIn, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * The id of the signed-in user, or null. Unlike useAuth it also works where
 * there is no provider, as in the tests of single components.
 */
export function useUserId(): string | null {
  return useContext(AuthContext)?.user?.id ?? null;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
