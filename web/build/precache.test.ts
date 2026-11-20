import { describe, expect, it } from 'vitest';
import { buildVersion, precacheList } from './precache';

describe('precacheList', () => {
  it('lists every file of the build as a path, without source maps and without the worker', () => {
    expect(
      precacheList(['index.html', 'assets/index-abc.js', 'assets/index-abc.js.map', 'sw.js', 'icons/icon-192.png']),
    ).toEqual(['/assets/index-abc.js', '/icons/icon-192.png', '/index.html']);
  });
});

describe('buildVersion', () => {
  it('changes with the content of any file, also one that keeps its name', () => {
    const files: [string, string][] = [
      ['index.html', '<html>'],
      ['icons/icon-192.png', 'old'],
    ];
    const before = buildVersion(files);
    expect(buildVersion([...files].reverse())).toBe(before);
    expect(buildVersion([files[0]!, ['icons/icon-192.png', 'new']])).not.toBe(before);
  });
});
