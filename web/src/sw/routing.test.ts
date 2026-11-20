import { describe, expect, it } from 'vitest';
import { routeFor } from './routing';

const origin = 'https://notes.example';
const precached = new Set(['/index.html', '/assets/index-abc.js', '/icons/icon-192.png']);
const get = (path: string, mode = 'cors') => ({ method: 'GET', url: `${origin}${path}`, mode });

describe('routeFor', () => {
  it('answers the files of the build from the cache', () => {
    expect(routeFor(get('/assets/index-abc.js'), origin, precached)).toBe('precache');
    expect(routeFor(get('/icons/icon-192.png?v=2'), origin, precached)).toBe('precache');
  });

  it('answers the pages of the app with the cached shell', () => {
    for (const path of ['/', '/notes', '/notes/6f1d1c1e?view=pinned', '/s/token', '/settings']) {
      expect(routeFor(get(path, 'navigate'), origin, precached)).toBe('shell');
    }
  });

  it('never touches the API, not even a page of it that is navigated to', () => {
    expect(routeFor(get('/api/notes'), origin, precached)).toBe('network');
    expect(routeFor(get('/api/notes/n1', 'navigate'), origin, precached)).toBe('network');
    expect(routeFor(get('/api/docs', 'navigate'), origin, precached)).toBe('network');
    expect(routeFor(get('/api', 'navigate'), origin, precached)).toBe('network');
    expect(routeFor(get('/healthz', 'navigate'), origin, precached)).toBe('network');
  });

  it('leaves alone what is not a plain GET of this origin, or not a file it knows', () => {
    expect(routeFor({ ...get('/assets/index-abc.js'), method: 'POST' }, origin, precached)).toBe('network');
    expect(routeFor({ ...get('/notes', 'navigate'), method: 'POST' }, origin, precached)).toBe('network');
    const elsewhere = { method: 'GET', url: 'https://cdn.example/assets/index-abc.js', mode: 'cors' };
    expect(routeFor(elsewhere, origin, precached)).toBe('network');
    expect(routeFor(get('/assets/gone-123.js'), origin, precached)).toBe('network');
    // An /apis page is the app's, not the API's.
    expect(routeFor(get('/apis', 'navigate'), origin, precached)).toBe('shell');
  });
});
