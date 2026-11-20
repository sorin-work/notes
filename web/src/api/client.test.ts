import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiError,
  getToken,
  json,
  onTokenRemovedElsewhere,
  setToken,
  setUnauthorizedHandler,
  withQuery,
} from './client';
import { staleNote } from './notes';

function respond(status: number, body?: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('api', () => {
  beforeEach(() => setToken('abc'));
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it('sends the token and JSON body', async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('/notes', json('POST', { title: 'x' }))).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Headers }];
    expect(url).toBe('/api/notes');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"title":"x"}');
    expect(init.headers.get('Authorization')).toBe('Bearer abc');
    expect(init.headers.get('Content-Type')).toBe('application/json');
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(api('/notes/1', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('turns validation errors into an ApiError with every message', async () => {
    vi.stubGlobal('fetch', respond(400, { message: ['name is required', 'email must be valid'], statusCode: 400 }));
    const error = await api('/auth/register').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, message: 'name is required' });
    expect((error as ApiError).messages).toHaveLength(2);
  });

  it('signs out when the saved token is rejected', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', respond(401, { message: 'Invalid or expired token' }));
    await expect(api('/notes')).rejects.toThrow('Invalid or expired token');
    expect(handler).toHaveBeenCalled();
  });

  it('keeps a token that replaced the rejected one while the request was on its way', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    // The answer arrives after another request has stored a new token.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        setToken('fresh');
        return new Response(JSON.stringify({ message: 'Invalid or expired token' }), { status: 401 });
      }),
    );

    await expect(api('/notes')).rejects.toThrow('Invalid or expired token');

    expect(handler).not.toHaveBeenCalled();
    expect(getToken()).toBe('fresh');
  });

  it('reports network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/notes')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('server') });
  });

  it('keeps the body of an error, which says more than the message for a refused save', async () => {
    const current = { id: 'n1', title: 'Plan', content: 'Theirs', revision: 4 };
    const body = { statusCode: 409, error: 'Conflict', message: 'Changed', code: 'stale_revision', note: current };
    vi.stubGlobal('fetch', respond(409, body));
    const error = await api('/notes/n1', json('PATCH', { content: 'Mine', revision: 3 })).catch((caught) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: 'Changed', body });
    expect(staleNote(error)).toEqual(current);

    // Other 409s, other errors and things that are no errors at all are not a stale save.
    vi.stubGlobal('fetch', respond(409, { statusCode: 409, message: 'This note is in the trash.' }));
    expect(staleNote(await api('/notes/n1', json('PATCH', {})).catch((caught) => caught))).toBeNull();
    expect(staleNote(new ApiError(0, 'Could not reach the server.'))).toBeNull();
    expect(staleNote(new Error('boom'))).toBeNull();
  });
});

describe('withQuery', () => {
  it('skips empty values', () => {
    expect(withQuery('/notes', { tag: 'work', notebookId: undefined, q: '', page: 2, pinned: false })).toBe(
      '/notes?tag=work&page=2&pinned=false',
    );
    expect(withQuery('/notes')).toBe('/notes');
  });
});

describe('onTokenRemovedElsewhere', () => {
  const storageEvent = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }));

  it('fires when another tab removed the token, not when it replaced it', () => {
    const handler = vi.fn();
    const stop = onTokenRemovedElsewhere(handler);

    // Another tab changed the password: the token was swapped, not removed.
    setToken('fresh');
    storageEvent('notes.token');
    storageEvent('notes.theme');
    expect(handler).not.toHaveBeenCalled();

    // Another tab signed out, or cleared the storage.
    setToken(null);
    storageEvent('notes.token');
    storageEvent(null);
    expect(handler).toHaveBeenCalledTimes(2);

    stop();
    storageEvent('notes.token');
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
