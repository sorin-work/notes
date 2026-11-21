import { verbatimParts } from './prose';
import {
  extractWikiLinks,
  findMention,
  findMentions,
  isLinkable,
  linkMention,
  normalizeTitle,
  onlyAddsLink,
  renameLinks,
  unlinkExcept,
} from './wikilinks';

describe('extractWikiLinks', () => {
  it('finds links and aliases', () => {
    expect(extractWikiLinks('See [[Project Atlas]] and [[Atlas data model|the data model]].')).toEqual([
      { title: 'Project Atlas', alias: null },
      { title: 'Atlas data model', alias: 'the data model' },
    ]);
  });

  it('skips math, in a line and in a block, as the preview does', () => {
    const text = 'Area $$[[A]] r^2$$ of [[Circle]]\n$$\n[[Inside]]\n$$\n[[After]] for $5 or [[Shop]] $10';
    expect(extractWikiLinks(text)).toEqual([
      { title: 'Circle', alias: null },
      { title: 'After', alias: null },
      { title: 'Shop', alias: null },
    ]);
  });

  it('skips math that runs over a line ending, and leaves its source alone in a rename', () => {
    const text = 'see $$a + [[Note]]\nb$$ here\n\n$$ x\n[[Note]]\n$$\n[[Note]]';
    expect(extractWikiLinks(text)).toEqual([{ title: 'Note', alias: null }]);
    expect(renameLinks(text, 'Note', 'Other')).toBe('see $$a + [[Note]]\nb$$ here\n\n$$ x\n[[Note]]\n$$\n[[Other]]');
  });

  it('drops a #heading from the target', () => {
    expect(extractWikiLinks('[[Recipes#Bread]]')).toEqual([{ title: 'Recipes', alias: null }]);
  });

  it('reads no link to another note in [[#Heading]], which the web app reads as a heading of the same note', () => {
    expect(extractWikiLinks('[[#Bread]] and [[#Bread|the bread]] and [[ #Bread]] and [[ \t|x]]')).toEqual([]);
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
      '[ref]: https://example.com/ref',
      '',
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

describe('mentions in what is not plain text', () => {
  it('does not put a title together from words on both sides of code, a link or a tag', () => {
    expect(findMention('run git `-i` rebase now', 'Git Rebase')).toBeNull();
    expect(findMention('run git [x](y.md) rebase now', 'Git Rebase')).toBeNull();
    expect(findMention('run git <b>rebase</b> now', 'Git Rebase')).toBeNull();
    expect(findMention('run git\nrebase now', 'Git Rebase')).toBeNull();
    expect(linkMention('run git `-i` rebase now, then git rebase.', 'Git Rebase')).toBe(
      'run git `-i` rebase now, then [[git rebase]].',
    );
  });

  it('leaves URLs, link text and reference definitions alone', () => {
    for (const text of [
      '[m](https://x.test/a_(b)/atlas)',
      '[the atlas](https://x.test)',
      '[a]: ./docs/atlas.md',
      'See www.atlas.org or https://atlas.dev/atlas.',
      '<https://atlas.org/atlas>',
      '![atlas](atlas.png)',
      'An <span title="atlas">aside</span>.',
      '<div>atlas</div>',
    ]) {
      expect(findMention(text, 'Atlas')).toBeNull();
      expect(linkMention(text, 'Atlas')).toBeNull();
    }
  });

  it('leaves code alone wherever it is', () => {
    for (const text of [
      '> ```\n> atlas\n> ```',
      '- item\n\n  ```\n  atlas\n  ```',
      'Then:\n\n    atlas in indented code',
      '~~~\natlas\n~~~',
      '``atlas ` still code``',
    ]) {
      expect(findMention(text, 'Atlas')).toBeNull();
    }
  });

  it('finds a title in a heading, a quote, a list and a table', () => {
    for (const text of ['# Atlas kickoff', '> the atlas', '- [ ] check atlas', '| a | atlas |\n| - | - |\n| 1 | 2 |']) {
      const linked = linkMention(text, 'Atlas');
      expect(linked?.replace(/\[\[|\]\]/g, '')).toBe(text);
      expect(linked).toMatch(/\[\[atlas\]\]/i);
    }
  });

  it('treats the marks of a script as part of the word', () => {
    expect(findMention('रामायण पढ़ी', 'राम')).toBeNull();
    expect(linkMention('कल राम आए', 'राम')).toBe('कल [[राम]] आए');
    // A letter with its accent as a separate mark is still one letter.
    expect(findMention('café society', 'cafe')).toBeNull();
  });
});

describe('linking one mention out of several', () => {
  const text = 'Use `atlas` here.\n\nThe Atlas is big. Read the atlas.';

  it('lists them in order and skips the one in code', () => {
    expect(findMentions(text, 'Atlas').map(({ start, end }) => text.slice(start, end))).toEqual(['Atlas', 'atlas']);
    expect(findMention(text, 'Atlas')).toEqual({ start: 23, end: 28 });
  });

  it('wraps the one it is told to, when it still reads as it did', () => {
    const second = text.lastIndexOf('atlas');
    expect(linkMention(text, 'Atlas', { offset: second, text: 'atlas' })).toBe(
      'Use `atlas` here.\n\nThe Atlas is big. Read the [[atlas]].',
    );
    expect(linkMention(text, 'Atlas', { offset: 23, text: 'Atlas' })).toBe(
      'Use `atlas` here.\n\nThe [[Atlas]] is big. Read the atlas.',
    );
  });

  it('wraps nothing when the place no longer holds that mention', () => {
    expect(linkMention(text, 'Atlas', { offset: 23, text: 'atlas' })).toBeNull();
    expect(linkMention(text, 'Atlas', { offset: 24, text: 'tlas' })).toBeNull();
    // The one inside code is at offset 5.
    expect(linkMention(text, 'Atlas', { offset: 5, text: 'atlas' })).toBeNull();
  });
});

describe('linking a mention in generated notes', () => {
  /** The same sequence of numbers for the same seed, so a failure can be run again. */
  function random(seed: number) {
    let state = seed >>> 0;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
    return {
      pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
      chance: (p: number) => next() < p,
    };
  }

  /** A note under construction. It remembers where it put the title as plain text, and what must never change. */
  class Draft {
    text = '';
    readonly plainTitles: { start: number; end: number }[] = [];
    readonly verbatim: { start: number; text: string }[] = [];

    add(piece: string): this {
      this.text += piece;
      return this;
    }
    /** The title as part of a sentence: a mention. */
    plain(written: string): this {
      this.plainTitles.push({ start: this.text.length, end: this.text.length + written.length });
      return this.add(written);
    }
    /** Code, a URL or HTML. It may hold the title, and it has to come out as it went in. */
    kept(piece: string): this {
      this.verbatim.push({ start: this.text.length, text: piece });
      return this.add(piece);
    }
  }

  const WORDS = ['notes', 'from', 'the', 'meeting', 'about', 'budget', 'and', 'plans', 'for', 'spring'];

  function generate(seed: number, title: string): Draft {
    const { pick, chance } = random(seed);
    const draft = new Draft();
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    // One kind of line ending for the whole note. A lone \r ends a line for the parser too.
    const eol = pick(['\n', '\n', '\r\n', '\r']);
    const written = () => pick([title, title.toLowerCase(), title.toUpperCase(), title.replace(/ /g, '  ')]);
    const words = () => Array.from({ length: 1 + Math.floor(seed % 3) }, () => pick(WORDS)).join(' ');
    /** Some words, now and then with the title among them. */
    const sentence = (density: number) => {
      draft.add(words());
      if (chance(density))
        draft
          .add(' ')
          .plain(written())
          .add(pick(['', '.', ',', ' again']));
    };

    const inline: (() => void)[] = [
      () => sentence(0.5),
      () => draft.add('*').add(words()).add(' ').plain(written()).add('*'),
      () => draft.add(pick(['&amp; ', '&copy; ', '&#169; ', '😀 ', '𝒜 '])).plain(written()),
      () => draft.add('𝒜').add(written()).add(' ').add(words()),
      () => draft.kept(`\`${words()} ${written()}\``),
      () => draft.kept(`\`\` ${words()} \` ${written()} \`\``),
      () => draft.kept(`[${words()} ${written()}](https://x.test/a_(b)/${slug})`),
      () => draft.kept(`[${pick(['*', '**', '~~', '_'])}${written()}${pick(['*', '**', '~~', '_'])}](http://x.com)`),
      () => draft.kept(`[${words()} ${written()}][ref]`),
      () => draft.kept(`![**${written()}** ${words()}](${slug}.png)`),
      () => draft.kept(`![${title}][ref]`),
      () => draft.kept(`<https://${slug}.example/${slug}>`),
      () => draft.kept(pick([`https://x.test/${slug}`, `www.${slug}.org`])),
      () => draft.kept(`<span title="${title}">`).add(words()).kept('</span>'),
      () => draft.add(pick([`[[${title}]]`, `[[${title}|${words()}]]`, '[[Another note]]'])),
    ];
    const line = () => {
      const parts = 1 + Math.floor(seed % 4);
      for (let i = 0; i < parts; i++) {
        if (i > 0) draft.add(' ');
        pick(inline)();
      }
    };

    // The reader of [[links]], here and in the preview, takes only \n for a
    // line ending. In a note with lone \r it sees one line, and after a fence
    // at its start that line is code, so no [[link]] works anywhere in such a
    // note and "Link" refuses. Fences with a lone \r are tested on their own.
    const fences: (() => void)[] =
      eol === '\r'
        ? []
        : [
            () => draft.kept(`\`\`\`${eol}${title} in a fence${eol}\`\`\``),
            () => draft.add('> ').kept(`\`\`\`${eol}> ${title} in a quoted fence${eol}> \`\`\``),
            () =>
              draft
                .add('- ')
                .add(words())
                .add(`${eol}${eol}  `)
                .kept(`\`\`\`${eol}  ${title} in a listed fence${eol}  \`\`\``),
          ];
    let afterList = false;
    const blocks: (() => void)[] = [
      () => line(),
      () => (draft.add('## '), sentence(0.6)),
      () => (draft.add('> '), sentence(0.6), draft.add(`${eol}> `), sentence(0.3)),
      () => (draft.add(pick(['- ', '1. ', '- [ ] '])), sentence(0.6), draft.add(`${eol}  `), sentence(0.3)),
      ...fences,
      () => draft.kept(`<div>${title}</div>`),
      () => {
        draft.add('| ');
        sentence(0.6);
        draft
          .add(` | b |${eol}| --- | --- |${eol}| x | `)
          .kept(`\`${title}\``)
          .add(' | ')
          .kept(`[${title}](x.md)`)
          .add(' |');
      },
      // Four spaces after a list would be more of the list, not code.
      () => (afterList ? line() : draft.add('    ').kept(`${title} as indented code`)),
    ];
    const count = 2 + Math.floor(seed % 7);
    for (let i = 0; i < count; i++) {
      if (i > 0) draft.add(eol + eol);
      const block = pick(blocks);
      block();
      afterList = block === blocks[3] || (fences.length > 0 && block === blocks[6]);
    }
    // The reference links above all lead somewhere.
    draft.add(eol + eol).kept(`[ref]: ./docs/${slug}.md`);
    return draft;
  }

  it.each(['Project Atlas', 'Atlas', 'Weekly sync', 'node.js'])(
    'only ever adds [[ ]] around the first plain mention of "%s"',
    (title) => {
      let linkedSome = 0;
      for (let seed = 1; seed <= 250; seed++) {
        const draft = generate(seed, title);
        const note = draft.text;
        const linked = linkMention(note, title);
        const first = draft.plainTitles[0];
        const context = `seed ${seed}:\n${JSON.stringify(note)}`;

        if (!first) {
          expect({ context, linked }).toEqual({ context, linked: null });
          continue;
        }
        linkedSome++;
        // Nothing but the two pairs of brackets, around a span the generator wrote as plain text.
        const expected = `${note.slice(0, first.start)}[[${note.slice(first.start, first.end)}]]${note.slice(first.end)}`;
        expect({ context, linked }).toEqual({ context, linked: expected });
        expect(normalizeTitle(note.slice(first.start, first.end))).toBe(normalizeTitle(title));
        // Every piece of code, every URL, link, image and all HTML is where it was, moved along by the brackets at most.
        for (const kept of draft.verbatim) {
          const moved = kept.start + (kept.start >= first.end ? 4 : kept.start >= first.start ? 2 : 0);
          expect((linked ?? '').slice(moved, moved + kept.text.length)).toBe(kept.text);
        }
        // Parsed again, the new text holds what the old one did, and one link more.
        expect({ context, check: onlyAddsLink(note, expected, first) }).toEqual({ context, check: true });
        expect(verbatimParts(linked ?? '')).toEqual(verbatimParts(note));
      }
      // The generator has to produce both kinds of note for the test to mean anything.
      expect(linkedSome).toBeGreaterThan(50);
      expect(linkedSome).toBeLessThan(250);
    },
  );
});

describe('what the parser of the preview reads differently', () => {
  it('never wraps a title inside the label of a link or image, emphasis and all', () => {
    for (const text of [
      '[*Atlas*](http://x.com)',
      '[**the atlas**](http://x.com)',
      '[~~atlas~~](http://x.com)',
      '![_atlas_](a.png)',
      '[*atlas*][r]\n\n[r]: /r',
      '| [*Atlas*](x.md) | b |\n| - | - |',
    ]) {
      expect(findMention(text, 'Atlas')).toBeNull();
      expect(linkMention(text, 'Atlas')).toBeNull();
    }
  });

  it('takes a lone \r or \r\n for a line ending, in code blocks, quotes and lists', () => {
    for (const text of [
      'a\r\r    Atlas code',
      'a\r\n\r\n    Atlas code',
      '> a\r>\r>     Atlas code',
      '- a\r\r      Atlas code',
      '```\rAtlas\r```',
      '> ```\r\n> Atlas\r\n> ```',
      '- a\r\n\r\n  ```\r\n  Atlas\r\n  ```',
    ]) {
      expect(findMention(text, 'Atlas')).toBeNull();
    }
    expect(linkMention('> a\r> the atlas', 'Atlas')).toBe('> a\r> the [[atlas]]');
    expect(linkMention('- a\r\n  the atlas', 'Atlas')).toBe('- a\r\n  the [[atlas]]');
  });
});

describe('what the preview would show differently after the brackets', () => {
  it('refuses when the brackets would change how emphasis, strong or strikethrough pair up', () => {
    for (const text of [
      'これは**Atlas**です',
      '私は*Atlas*が好き',
      '新しい~~Atlas~~計画',
      'x *Atlas*y',
      'x _Atlas_.y',
    ]) {
      expect(linkMention(text, 'Atlas')).toBeNull();
      expect(findMention(text, 'Atlas')).toBeNull();
    }
    // Where the marks still pair up, the mention is linked inside them.
    expect(linkMention('An *old atlas* here', 'Atlas')).toBe('An *old [[atlas]]* here');
  });

  it('does not put brackets after a "!", where they would open an image', () => {
    expect(findMention('Done!Atlas next', 'Atlas')).toBeNull();
    expect(linkMention('Done! Atlas next', 'Atlas')).toBe('Done! [[Atlas]] next');
  });

  it('skips table cells beyond the columns of the header, which the preview does not show', () => {
    expect(findMention('| a |\n|---|\n| x | Atlas |', 'Atlas')).toBeNull();
    expect(linkMention('| a | b |\n|---|---|\n| x | Atlas |', 'Atlas')).toBe('| a | b |\n|---|---|\n| x | [[Atlas]] |');
  });
});

describe('onlyAddsLink', () => {
  const at = (text: string, word: string) => ({ start: text.indexOf(word), end: text.indexOf(word) + word.length });
  const wrap = (text: string, word: string) => text.replace(word, `[[${word}]]`);

  it('accepts brackets around plain text and nothing else', () => {
    const text = 'The atlas, `code` and [a](b).';
    expect(onlyAddsLink(text, wrap(text, 'atlas'), at(text, 'atlas'))).toBe(true);
    expect(onlyAddsLink(text, `${wrap(text, 'atlas')} `, at(text, 'atlas'))).toBe(false);
  });

  it('refuses brackets that the parser reads as something else', () => {
    // With a definition of that name the brackets make a reference link, not a [[link]].
    const text = 'The atlas.\n\n[atlas]: https://x.test';
    expect(onlyAddsLink(text, wrap(text, 'atlas'), at(text, 'atlas'))).toBe(false);
    expect(linkMention(text, 'Atlas')).toBeNull();
    // An opening bracket just before makes three, and the link reads from the second.
    const bracket = 'See [atlas and more';
    expect(onlyAddsLink(bracket, wrap(bracket, 'atlas'), at(bracket, 'atlas'))).toBe(true);
  });

  it('refuses a change to code, a link or HTML anywhere in the note', () => {
    const text = 'The atlas `code`';
    expect(onlyAddsLink(text, 'The [[atlas]] `code`', at(text, 'atlas'))).toBe(true);
    expect(onlyAddsLink(`${text}x`, 'The [[atlas]] `code`', at(text, 'atlas'))).toBe(false);
  });

  it('lets "Link" go past a mention it refuses to the next one', () => {
    const text = 'The atlas.\n\nAn atlas.\n\n[atlas]: https://x.test';
    expect(findMentions(text, 'Atlas')).toHaveLength(2);
    // Both would make a reference link: none is offered.
    expect(findMention(text, 'Atlas')).toBeNull();
    const other = 'Use `x` [atlas]: and the atlas.';
    expect(linkMention(other, 'Atlas')).toBe('Use `x` [[[atlas]]]: and the atlas.');
  });
});

describe('mentions in very large or hostile notes', () => {
  it('stays quick however many brackets a note has, and offers nothing in a note it does not parse', () => {
    const started = Date.now();
    for (const mark of ['[', '[[', '[[a', '<', '\r', '> \n']) {
      const hostile = mark.repeat(Math.floor(40_000 / mark.length));
      expect(findMention(hostile, 'Atlas')).toBeNull();
      expect(linkMention(`${hostile}\n\nThe atlas.`, 'Atlas')).not.toBeNull();
    }
    for (const mark of [']]', '](', '1. ', '> ']) {
      const hostile = mark.repeat(40_000);
      expect(linkMention(`${hostile}\n\nThe atlas.`, 'Atlas')).toBeNull();
    }
    expect(linkMention(`${'x'.repeat(100_000)}\n\nThe atlas.`, 'Atlas')).toBeNull();
    // A line of backticks opens a code block that is never closed, so what follows is code.
    expect(linkMention(`${'`'.repeat(40_000)}\n\nThe atlas.`, 'Atlas')).toBeNull();
    // Seconds in practice. The limit catches work that grows with the square of the length.
    expect(Date.now() - started).toBeLessThan(30_000);
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

  it('keeps links to a heading of the note itself, which lead nowhere else', () => {
    const text = '[[#Method]], [[ #Method]], [[  #Method|how]] and [[Starter#Feeding]]';
    expect(unlinkExcept(text, shared)).toBe(text);
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
