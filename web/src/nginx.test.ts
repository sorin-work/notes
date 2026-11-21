import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(import.meta.dirname, '..');
const config = readFileSync(join(web, 'nginx.conf'), 'utf8');
const snippet = readFileSync(join(web, 'security-headers.conf'), 'utf8');
const dockerfile = readFileSync(join(web, 'Dockerfile'), 'utf8');

const INCLUDE = '/etc/nginx/snippets/security-headers.conf';

/** Without comments, so that a line that only mentions a directive does not count. */
function code(text: string): string {
  return text.replace(/#.*$/gm, '');
}

interface Location {
  match: string;
  /** Everything between its braces, nested blocks included. */
  body: string;
  /** How many locations it is inside of: 0 for one right in the server block. */
  depth: number;
}

/**
 * Each `location` block of nginx.conf, found by counting braces, so that a
 * location inside another one is found too and its body is all of it.
 * Braces inside quotes are not counted: a header value or a regex may hold
 * them.
 */
function locations(): Location[] {
  const text = code(config);
  const found: Location[] = [];
  const opened: { at: number; match: string | null }[] = [];
  let quote: string | null = null;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quote) {
      if (char === '\\') at++;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      const head = /location\s+([^;{}]+?)\s*$/.exec(text.slice(0, at));
      opened.push({ at, match: head ? (head[1] ?? '') : null });
    } else if (char === '}') {
      const block = opened.pop();
      if (!block) throw new Error(`a } without its { at ${at}`);
      if (block.match !== null) {
        const depth = opened.filter((outer) => outer.match !== null).length;
        found.push({ match: block.match, body: text.slice(block.at + 1, at), depth });
      }
    }
  }
  if (quote) throw new Error('a quote that is not closed');
  if (opened.length > 0) throw new Error('a { without its }');
  return found;
}

function isApi(match: string): boolean {
  return /^(=\s*|~\s*\^)?\/api\//.test(match);
}

function headers(): Map<string, string> {
  const found = new Map<string, string>();
  for (const [, name = '', value = '', always] of code(snippet).matchAll(
    /add_header\s+(\S+)\s+"([^"]*)"\s*(always)?\s*;/g,
  )) {
    expect({ name, always }).toEqual({ name, always: 'always' });
    found.set(name, value);
  }
  return found;
}

/**
 * nginx forgets the add_header lines of the server block in a location that
 * has one of its own, and most locations set Cache-Control. So the headers
 * live in one file that every location must include, which this checks the
 * way styles.contrast.test.ts checks the stylesheet.
 */
describe('nginx.conf', () => {
  it('finds the locations it checks', () => {
    const matches = locations().map((location) => location.match);
    expect(matches).toEqual(expect.arrayContaining(['/', '= /index.html', '/assets/', '= /sw.js', '/api/']));
  });

  it('has no location inside another, where the include of the outer one would be dropped', () => {
    expect(
      locations()
        .filter((location) => location.depth > 0)
        .map((location) => location.match),
    ).toEqual([]);
  });

  it('includes the security headers in every location outside /api/', () => {
    const missing = locations()
      .filter((location) => !isApi(location.match) && !location.body.includes(`include ${INCLUDE};`))
      .map((location) => location.match);
    expect(missing).toEqual([]);
  });

  it('leaves the answers of the API to the API', () => {
    const api = locations().filter((location) => isApi(location.match));
    expect(api.length).toBeGreaterThan(0);
    for (const location of api) {
      expect({ location: location.match, adds: /add_header|include/.test(location.body) }).toEqual({
        location: location.match,
        adds: false,
      });
    }
  });

  it('puts no headers on the server block, where a location would drop them unseen', () => {
    let outside = code(config);
    // Outer locations first: their bodies hold the inner ones.
    const outermost = locations().sort((a, b) => a.depth - b.depth);
    for (const location of outermost) outside = outside.replace(location.body, '');
    expect(outside).not.toMatch(/add_header/);
  });

  it('copies the file into the image where the include looks for it, outside conf.d', () => {
    expect(dockerfile).toContain(`COPY security-headers.conf ${INCLUDE}`);
  });
});

describe('security-headers.conf', () => {
  it('sets a policy that allows scripts from the app only and no framing', () => {
    const policy = headers().get('Content-Security-Policy') ?? '';
    const directives = new Map(
      policy.split(';').map((part) => {
        const [name, ...values] = part.trim().split(/\s+/);
        return [name, values.join(' ')];
      }),
    );
    expect(Object.fromEntries(directives)).toEqual({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': "'self'",
      'img-src': "'self' blob: data: https:",
      'worker-src': "'self'",
      'object-src': "'none'",
      'base-uri': "'self'",
      'form-action': "'self'",
      'frame-ancestors': "'none'",
    });
  });

  it('sets the other headers', () => {
    const all = headers();
    expect(all.get('X-Content-Type-Options')).toBe('nosniff');
    expect(all.get('Referrer-Policy')).toBe('no-referrer');
    expect(all.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });
});
