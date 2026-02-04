import { describe, expect, it } from 'vitest';
import { linkifyWikiLinks, normalizeTitle, openLinkAt, wikiTarget } from './wikilinks';

describe('linkifyWikiLinks', () => {
  it('turns wiki links into wiki: links', () => {
    expect(linkifyWikiLinks('See [[Project Atlas]].')).toBe('See [Project Atlas](wiki:Project%20Atlas).');
  });

  it('uses the alias as the link text', () => {
    expect(linkifyWikiLinks('[[Atlas data model|the model]]')).toBe('[the model](wiki:Atlas%20data%20model)');
  });

  it('drops the heading part of the target', () => {
    expect(linkifyWikiLinks('[[Recipes#Bread]]')).toBe('[Recipes](wiki:Recipes)');
  });

  it('leaves fenced and inline code alone', () => {
    const markdown = '```\n[[In code]]\n```\n`[[inline]]` and [[Real]]';
    expect(linkifyWikiLinks(markdown)).toBe('```\n[[In code]]\n```\n`[[inline]]` and [Real](wiki:Real)');
  });

  it('escapes brackets in the link text', () => {
    expect(linkifyWikiLinks('[[Note|a [b] c]]')).toBe('[[Note|a [b] c]]');
    expect(linkifyWikiLinks('[[Q&A]]')).toBe('[Q&A](wiki:Q%26A)');
  });
});

describe('wikiTarget', () => {
  it('decodes wiki: hrefs', () => {
    expect(wikiTarget('wiki:Project%20Atlas')).toBe('Project Atlas');
  });

  it('ignores other links and broken encodings', () => {
    expect(wikiTarget('https://example.com')).toBeNull();
    expect(wikiTarget(undefined)).toBeNull();
    expect(wikiTarget('wiki:%E0%A4%A')).toBeNull();
  });
});

describe('openLinkAt', () => {
  it('finds an unfinished link before the cursor', () => {
    expect(openLinkAt('Hello [[Pro', 11)).toEqual({ start: 6, query: 'Pro' });
    expect(openLinkAt('[[', 2)).toEqual({ start: 0, query: '' });
  });

  it('returns null when the link is closed or there is none', () => {
    expect(openLinkAt('[[Done]] more', 13)).toBeNull();
    expect(openLinkAt('no link', 7)).toBeNull();
    expect(openLinkAt('[[line\nbreak', 12)).toBeNull();
  });
});

describe('normalizeTitle', () => {
  it('matches the API', () => {
    expect(normalizeTitle('  Project   Atlas ')).toBe('project atlas');
  });
});
