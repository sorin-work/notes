import { extractWikiLinks, findMention, linkMention, normalizeTitle } from './wikilinks';

describe('extractWikiLinks', () => {
  it('finds links and aliases', () => {
    expect(extractWikiLinks('See [[Project Atlas]] and [[Atlas data model|the data model]].')).toEqual([
      { title: 'Project Atlas', alias: null },
      { title: 'Atlas data model', alias: 'the data model' },
    ]);
  });

  it('drops a #heading from the target', () => {
    expect(extractWikiLinks('[[Recipes#Bread]]')).toEqual([{ title: 'Recipes', alias: null }]);
  });

  it('lists each target once, matching case-insensitively', () => {
    expect(extractWikiLinks('[[Ideas]] then [[ideas]] and [[ Ideas ]]')).toEqual([{ title: 'Ideas', alias: null }]);
  });

  it('collapses whitespace in titles', () => {
    expect(extractWikiLinks('[[Weekly   review]]')).toEqual([{ title: 'Weekly review', alias: null }]);
  });

  it('ignores empty and unclosed links', () => {
    expect(extractWikiLinks('[[]] [[   ]] [[open and [[Closed]]')).toEqual([{ title: 'Closed', alias: null }]);
  });

  it('does not span lines', () => {
    expect(extractWikiLinks('[[First\nline]]')).toEqual([]);
  });

  it('ignores links in fenced code blocks', () => {
    const markdown = ['[[Before]]', '```', '[[Inside]]', '```', '~~~ts', '[[Tilde]]', '~~~', '[[After]]'].join('\n');
    expect(extractWikiLinks(markdown).map((link) => link.title)).toEqual(['Before', 'After']);
  });

  it('only closes a fence with the same marker', () => {
    const markdown = ['````', '```', '[[Still code]]', '````', '[[Text]]'].join('\n');
    expect(extractWikiLinks(markdown).map((link) => link.title)).toEqual(['Text']);
  });

  it('ignores links in inline code', () => {
    expect(extractWikiLinks('Type `[[Title]]` to link, like [[Real]]. ``a [[b]] c``').map((l) => l.title)).toEqual([
      'Real',
    ]);
  });

  it('handles Windows line endings', () => {
    expect(extractWikiLinks('```\r\n[[Code]]\r\n```\r\n[[Text]]').map((link) => link.title)).toEqual(['Text']);
  });
});

describe('normalizeTitle', () => {
  it('lower-cases and collapses whitespace', () => {
    expect(normalizeTitle('  Project   Atlas ')).toBe('project atlas');
  });
});

describe('findMention', () => {
  const at = (text: string, title: string) => {
    const mention = findMention(text, title);
    return mention && text.slice(mention.start, mention.end);
  };

  it('finds a title written out in the text, whatever its case and spacing', () => {
    expect(at('We met about project  atlas today.', 'Project Atlas')).toBe('project  atlas');
    expect(at('First line\r\nThen PROJECT ATLAS.', 'Project Atlas')).toBe('PROJECT ATLAS');
  });

  it('only matches whole words', () => {
    expect(findMention('Two atlases and a Catlas.', 'Atlas')).toBeNull();
    expect(at('The (atlas), again.', 'Atlas')).toBe('atlas');
    expect(findMention('Weekly\nsync', 'Weekly sync')).toBeNull();
  });

  it('skips code, links of every kind, images, tags and URLs', () => {
    const text = [
      '```',
      'Atlas in a fence',
      '```',
      'Inline `Atlas` code, [[Atlas]], [[Project Atlas|the Atlas]] and [Atlas](https://example.com).',
      '![Atlas](atlas.png) [Atlas][ref] <span title="Atlas"> https://example.com/Atlas',
    ].join('\n');
    expect(findMention(text, 'Atlas')).toBeNull();
    expect(at(`${text}\nAnd Atlas itself.`, 'Atlas')).toBe('Atlas');
  });

  it('has nothing for titles that are too short or cannot be written as a link', () => {
    expect(findMention('Go is a language.', 'Go')).toBeNull();
    expect(findMention('See C# notes.', 'C# notes')).toBeNull();
    expect(findMention('The a|b test.', 'a|b test')).toBeNull();
    expect(findMention('Use `x` here.', '`x` here')).toBeNull();
  });

  it('treats the characters of a title as text, not as a pattern', () => {
    expect(at('Costs (2026) are up.', 'Costs (2026)')).toBe('Costs (2026)');
    expect(findMention('Costs 2026 are up.', 'Costs (2026)')).toBeNull();
    expect(at('Is it a.b.c or axbxc?', 'a.b.c')).toBe('a.b.c');
  });
});

describe('linkMention', () => {
  it('wraps the first mention as it was written', () => {
    expect(linkMention('About project atlas, and Project Atlas again.', 'Project Atlas')).toBe(
      'About [[project atlas]], and Project Atlas again.',
    );
  });

  it('leaves the links the note already had', () => {
    const linked = linkMention('See [[Ideas]].\n\n```\nAtlas\n```\n\n## Atlas plans', 'Atlas');
    expect(linked).toBe('See [[Ideas]].\n\n```\nAtlas\n```\n\n## [[Atlas]] plans');
    expect(extractWikiLinks(linked ?? '').map((link) => link.title)).toEqual(['Ideas', 'Atlas']);
  });

  it('returns null when there is nothing to link', () => {
    expect(linkMention('Already [[Atlas]].', 'Atlas')).toBeNull();
    expect(linkMention('Nothing here.', 'Atlas')).toBeNull();
  });
});
