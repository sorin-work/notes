import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, json, setToken, setUnauthorizedHandler, withQuery } from './client';

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

  it('reports network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(api('/notes')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('server') });
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
