import { extractWikiLinks, isLinkable, normalizeTitle, renameLinks, unlinkExcept } from './wikilinks';

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

describe('unlinkExcept', () => {
  const shared = (key: string) => key === 'starter';

  it('keeps the links a reader may follow and writes the others out as their text', () => {
    expect(unlinkExcept('See [[Starter]] and [[ starter |my starter]], not [[Secret plan]].', shared)).toBe(
      'See [[Starter]] and [[ starter |my starter]], not Secret plan.',
    );
  });

  it('writes out an alias as it stands in the note, inline code and all', () => {
    expect(unlinkExcept('[[Secret|see `x` here]] and [[Starter|the `y`]]', shared)).toBe(
      'see `x` here and [[Starter|the `y`]]',
    );
  });

  it('leaves no trace of a title that was behind an alias, or of a heading', () => {
    const text = unlinkExcept(
      '[[Secret plan|a plan]] and [[Secret plan#Budget]] and [[Budget 2026#Q1|numbers]]',
      shared,
    );
    expect(text).toBe('a plan and Secret plan and numbers');
    expect(text).not.toContain('Budget 2026');
  });

  it('does not touch code, and copes with a note that has no links', () => {
    const code = 'Use `[[Secret plan|x]]` like this:\n\n```\n[[Secret plan|y]]\n```\n';
    expect(unlinkExcept(code, shared)).toBe(code);
    expect(unlinkExcept('Nothing to see.', shared)).toBe('Nothing to see.');
    expect(unlinkExcept('', shared)).toBe('');
  });

  it('treats every link the same when none may be followed', () => {
    expect(unlinkExcept('[[A]] [[B|b]] [[C]]', () => false)).toBe('A b C');
  });
});
