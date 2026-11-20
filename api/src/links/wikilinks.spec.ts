import { extractWikiLinks, findMention, isLinkable, linkMention, normalizeTitle, renameLinks } from './wikilinks';

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

describe('renameLinks', () => {
  it('points links at the new title and keeps heading and alias', () => {
    expect(renameLinks('See [[Atlas]], [[Atlas#Goals]] and [[Atlas|the project]].', 'Atlas', 'Project Atlas')).toBe(
      'See [[Project Atlas]], [[Project Atlas#Goals]] and [[Project Atlas|the project]].',
    );
    expect(renameLinks('[[Atlas#Goals|the goals]]', 'Atlas', 'Project Atlas')).toBe(
      '[[Project Atlas#Goals|the goals]]',
    );
  });

  it('matches titles the way links are matched to notes', () => {
    expect(renameLinks('[[atlas]] [[ ATLAS ]] [[Weekly   review]]', ' Atlas', 'Project Atlas')).toBe(
      '[[Project Atlas]] [[Project Atlas]] [[Weekly   review]]',
    );
    expect(renameLinks('[[weekly REVIEW]]', 'Weekly  review', 'Review')).toBe('[[Review]]');
  });

  it('leaves other links, longer titles and plain text alone', () => {
    const markdown =
      'Atlas is in [[Atlas data model]], not [[Other]] or [[Atlas 2|Atlas]]. [Atlas](https://atlas.test)';
    expect(renameLinks(markdown, 'Atlas', 'Project Atlas')).toBe(markdown);
  });

  it('skips code the way extractWikiLinks does', () => {
    const markdown = ['`[[Atlas]]` and [[Atlas]]', '```', '[[Atlas]]', '```', '~~~md', '[[Atlas]]', '~~~'].join('\n');
    expect(renameLinks(markdown, 'Atlas', 'Project Atlas')).toBe(
      ['`[[Atlas]]` and [[Project Atlas]]', '```', '[[Atlas]]', '```', '~~~md', '[[Atlas]]', '~~~'].join('\n'),
    );
    // Code between the brackets: the title is not what is written there, so the link stays.
    expect(renameLinks('[[At`l`as]] [[At l as]]', 'At l as', 'Atlas')).toBe('[[At`l`as]] [[Atlas]]');
  });

  it('keeps line endings and everything around the links', () => {
    expect(renameLinks('# Notes\r\n\r\n- [ ] ask [[Atlas]]\r\n\tend  \r\n', 'Atlas', 'New')).toBe(
      '# Notes\r\n\r\n- [ ] ask [[New]]\r\n\tend  \r\n',
    );
  });

  it('changes nothing when the new title cannot be written as a link', () => {
    const markdown = 'See [[Atlas]] and `code`.';
    for (const title of ['C# notes', 'Pros | cons', 'Array[0]', 'Use `x', 'Two\nlines', '  ']) {
      expect(renameLinks(markdown, 'Atlas', title)).toBe(markdown);
    }
    expect(renameLinks(markdown, '  ', 'New')).toBe(markdown);
  });

  it('rewrites exactly the links to the old title in notes put together at random', () => {
    // Each piece is paired with what it has to become. Pieces are joined with
    // spaces and line endings, so none can change what its neighbour means.
    const pieces: [string, string][] = [
      ['[[Atlas]]', '[[Project Atlas]]'],
      ['[[ atlas ]]', '[[Project Atlas]]'],
      ['[[ATLAS#Open questions]]', '[[Project Atlas#Open questions]]'],
      ['[[Atlas|the old name]]', '[[Project Atlas|the old name]]'],
      ['[[Atlas data model]]', '[[Atlas data model]]'],
      ['[[Project Atlas]]', '[[Project Atlas]]'],
      ['`[[Atlas]]`', '`[[Atlas]]`'],
      ['``a [[Atlas]] `b` ``', '``a [[Atlas]] `b` ``'],
      ['[Atlas](https://example.com/Atlas)', '[Atlas](https://example.com/Atlas)'],
      ['[[Atlas', '[[Atlas'],
      ['Atlas]] words', 'Atlas]] words'],
      ['- [ ] task', '- [ ] task'],
    ];
    const fence: [string, string] = ['```\n[[Atlas]]\n```', '```\n[[Atlas]]\n```'];
    let seed = 7;
    const below = (limit: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % limit;
    };
    for (let round = 0; round < 300; round++) {
      const eol = below(2) ? '\n' : '\r\n';
      const lines: [string, string][] = Array.from({ length: 1 + below(8) }, () => {
        if (below(6) === 0) return [fence[0].replaceAll('\n', eol), fence[1].replaceAll('\n', eol)];
        const picked = Array.from({ length: below(5) }, () => pieces[below(pieces.length)]);
        return [picked.map((piece) => piece[0]).join(' '), picked.map((piece) => piece[1]).join(' ')];
      });
      const before = lines.map((line) => line[0]).join(eol);
      const after = lines.map((line) => line[1]).join(eol);
      expect(renameLinks(before, 'Atlas', 'Project Atlas')).toBe(after);
      expect(renameLinks(after, 'Atlas', 'Project Atlas')).toBe(after);
    }
  });
});

describe('isLinkable', () => {
  it('accepts titles that read back as a link to themselves', () => {
    expect(isLinkable('Project Atlas')).toBe(true);
    expect(isLinkable('Q&A: 2026 (draft)')).toBe(true);
  });

  it('rejects titles that would break or change the link', () => {
    for (const title of ['C# notes', 'a|b', 'x[1]', '[draft', 'tick `me`', 'one ` tick', 'a\nb', 'a\rb', '', '   ']) {
      expect(isLinkable(title)).toBe(false);
    }
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
