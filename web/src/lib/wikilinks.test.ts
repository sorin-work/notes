import { describe, expect, it } from 'vitest';
import { linkifyWikiLinks, normalizeTitle, openLinkAt, wikiTarget } from './wikilinks';

describe('linkifyWikiLinks', () => {
  it('turns wiki links into wiki: links', () => {
    expect(linkifyWikiLinks('See [[Project Atlas]].')).toBe('See [Project Atlas](wiki:Project%20Atlas).');
  });

  it('uses the alias as the link text', () => {
    expect(linkifyWikiLinks('[[Atlas data model|the model]]')).toBe('[the model](wiki:Atlas%20data%20model)');
  });

  it('keeps the heading part of the target', () => {
    expect(linkifyWikiLinks('[[Recipes#Bread  rolls]]')).toBe('[Recipes › Bread rolls](wiki:Recipes#Bread%20rolls)');
    expect(linkifyWikiLinks('[[Recipes#Bread|bread]]')).toBe('[bread](wiki:Recipes#Bread)');
    expect(linkifyWikiLinks('[[Recipes#]]')).toBe('[Recipes](wiki:Recipes)');
  });

  it('reads [[#Heading]] as a link within the note', () => {
    expect(linkifyWikiLinks('[[#Next steps]] and [[#Q&A|questions]]')).toBe(
      '[Next steps](wiki:#Next%20steps) and [questions](wiki:#Q%26A)',
    );
    // A blank title is no title, as in the API, which leaves these alone too.
    expect(linkifyWikiLinks('[[ #Goals]] [[  #Goals|the goals]]')).toBe(
      '[Goals](wiki:#Goals) [the goals](wiki:#Goals)',
    );
  });

  it('leaves links to nothing as they are', () => {
    expect(linkifyWikiLinks('[[]] [[#]] [[|text]]')).toBe('[[]] [[#]] [[|text]]');
  });

  it('leaves math alone, in a line and in a block', () => {
    expect(linkifyWikiLinks('Area $$[[A]] r^2$$ of [[Circle]]')).toBe('Area $$[[A]] r^2$$ of [Circle](wiki:Circle)');
    expect(linkifyWikiLinks('$$\n[[x]]\n$$\n[[After]]')).toBe('$$\n[[x]]\n$$\n[After](wiki:After)');
    // A single dollar is no math.
    expect(linkifyWikiLinks('Costs $5 at [[Shop]], or $10')).toBe('Costs $5 at [Shop](wiki:Shop), or $10');
  });

  it('leaves fenced and inline code alone', () => {
    const markdown = '```\n[[In code]]\n```\n`[[inline]]` and [[Real]]';
    expect(linkifyWikiLinks(markdown)).toBe('```\n[[In code]]\n```\n`[[inline]]` and [Real](wiki:Real)');
  });

  it('puts a line break that was inside a link in front of it', () => {
    expect(linkifyWikiLinks('Notes for [[Project\rAtlas]] this week')).toBe(
      'Notes for \r[Project Atlas](wiki:Project%20Atlas) this week',
    );
  });

  it.each([
    'Notes for [[Project\rAtlas]] this week\r\r- [ ] one\r- [ ] two',
    '[[Recipes#Bre\rad]]\n- [ ] one',
    '[[Atlas|\rthe project\r]] and\r\n[[Atlas|the\rproject]]',
    'before\r[[Weekly\r\rreview]]\r\nafter',
    '`[[in\rcode]]` and [[Real\r]]\n```\n[[fenced\r]]\n```',
  ])('keeps the line endings of %j', (text) => {
    const lineEndings = (value: string) => value.match(/\r\n?|\n/g);
    expect(lineEndings(linkifyWikiLinks(text))).toEqual(lineEndings(text));
  });

  it('escapes brackets in the link text', () => {
    expect(linkifyWikiLinks('[[Note|a [b] c]]')).toBe('[[Note|a [b] c]]');
    expect(linkifyWikiLinks('[[Q&A]]')).toBe('[Q&A](wiki:Q%26A)');
  });
});

describe('wikiTarget', () => {
  it('decodes wiki: hrefs', () => {
    expect(wikiTarget('wiki:Project%20Atlas')).toEqual({ title: 'Project Atlas', heading: null });
    expect(wikiTarget('wiki:A%23B#C%23D')).toEqual({ title: 'A#B', heading: 'C#D' });
    expect(wikiTarget('wiki:#Intro')).toEqual({ title: '', heading: 'Intro' });
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
