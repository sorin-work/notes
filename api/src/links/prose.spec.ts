import { MAX_PARSED_NOTE_LENGTH, MAX_TASK_TEXT, parseNote, parseTasks, proseSpans, verbatimParts } from './prose';

const texts = (markdown: string) => proseSpans(markdown).map((span) => markdown.slice(span.from, span.to));

describe('proseSpans', () => {
  it('keeps the words of sentences, headings, lists, quotes and table cells', () => {
    const note = [
      '# Atlas kickoff',
      '',
      'Plain words, *with emphasis*, **strong** and ~~struck~~.',
      '',
      '> A quote',
      '> over two lines',
      '',
      '- [ ] a task',
      '- an item',
      '  that goes on',
      '',
      '| Head | B |',
      '| --- | --- |',
      '| cell | x |',
    ].join('\n');
    expect(texts(note)).toEqual([
      'Atlas kickoff',
      'Plain words, ',
      'with emphasis',
      ', ',
      'strong',
      ' and ',
      'struck',
      '.',
      'A quote',
      'over two lines',
      'a task',
      'an item',
      'that goes on',
      'Head',
      'B',
      'cell',
      'x',
    ]);
  });

  it('leaves out code of every kind', () => {
    const note = [
      'Inline `code` here.',
      '',
      '```',
      'fenced',
      '```',
      '',
      '> ```',
      '> fenced in a quote',
      '> ```',
      '',
      '- item',
      '',
      '  ```',
      '  fenced in a list',
      '  ```',
      '',
      'Then:',
      '',
      '    indented code',
    ].join('\n');
    expect(texts(note)).toEqual(['Inline ', ' here.', 'item', 'Then:']);
  });

  it('leaves out links, images, reference definitions, URLs, HTML and escapes', () => {
    const note = [
      'See [the label](https://x.test/a_(b)/page), ![a picture](p.png), <https://auto.link>,',
      'www.bare.org and https://bare.dev/x, [a ref][r], <b>bold</b>, &amp; and \\*.',
      '',
      '[r]: ./docs/page.md "Title"',
      '',
      '<div>a block of html</div>',
    ].join('\n');
    expect(texts(note)).toEqual(['See ', ', ', ', ', ',', ' and ', ', ', ', ', 'bold', ', ', ' and ', '.']);
  });

  it('leaves out everything inside the label of a link or an image, emphasis and all', () => {
    expect(texts('[*Atlas*](http://x.com) ![**the** atlas](a.png) [~~x~~][r] [_y_]\n\n[r]: /r\n[_y_]: /y')).toEqual([
      ' ',
      ' ',
      ' ',
    ]);
    expect(texts('| [*Atlas*](x.md) | b |\n| - | - |')).toEqual(['b']);
  });

  it('never lets a stretch cross a line break, whichever kind it is', () => {
    expect(texts('one\ntwo\n\nthree')).toEqual(['one', 'two', 'three']);
    expect(texts('one\r\ntwo\r\n\r\nthree')).toEqual(['one', 'two', 'three']);
    expect(texts('one\rtwo\r\rthree')).toEqual(['one', 'two', 'three']);
    expect(proseSpans('')).toEqual([]);
  });

  it('takes a lone \r for a line ending, as the preview does, in code blocks, quotes and lists', () => {
    expect(texts('a\r\r    Atlas code')).toEqual(['a']);
    expect(texts('a\r\n\r\n    Atlas code')).toEqual(['a']);
    expect(texts('> a\r>\r>     Atlas code\r> b')).toEqual(['a', 'b']);
    expect(texts('- a\r\r      Atlas code')).toEqual(['a']);
    expect(texts('- a\r\n  b\r\n- c')).toEqual(['a', 'b', 'c']);
    expect(texts('```\rAtlas\r```\rafter')).toEqual(['after']);
    expect(texts('> ```\r\n> Atlas\r\n> ```\r\n> after')).toEqual(['after']);
  });

  it('gives no plain text at all for a note it does not parse', () => {
    expect(parseNote('word '.repeat(MAX_PARSED_NOTE_LENGTH / 5))).not.toBeNull();
    expect(parseNote(`${'word '.repeat(MAX_PARSED_NOTE_LENGTH / 5)}!`)).toBeNull();
    expect(parseNote('[a](b) '.repeat(2_001))).toBeNull();
    expect(parseNote(`${'> '.repeat(17)}deep`)).toBeNull();
    expect(parseNote(`${'1. '.repeat(17)}deep`)).toBeNull();
    expect(parseNote(`${'> '.repeat(16)}deep enough`)).not.toBeNull();
  });

  it('gets through long notes that nest or repeat a mark, and gives up on the ones that would take too long', () => {
    const started = Date.now();
    for (const mark of [
      '[',
      '[[',
      ']]',
      '](',
      '`',
      '<',
      '*',
      '_',
      '> ',
      '- ',
      '1. ',
      '|',
      '!',
      '\\',
      '&',
      '\r',
      '- a\n',
    ]) {
      const note = mark.repeat(Math.floor(MAX_PARSED_NOTE_LENGTH / mark.length));
      expect(() => parseNote(note)).not.toThrow();
    }
    // Seconds at most. The limit catches work that grows with the square of the length.
    expect(Date.now() - started).toBeLessThan(30_000);
  });
});

describe('verbatimParts', () => {
  it('lists code, HTML, links, images, references and definitions in order, each as it is written', () => {
    const note = [
      'A `span`, [x *y*](https://x.test/a_(b)), www.bare.org, ![p](p.png), [r][], [^1] and <i>tag</i>.',
      '',
      '```js',
      'code',
      '```',
      '',
      '    more code',
      '',
      '[r]: ./r.md',
      '[^1]: A note.',
    ].join('\n');
    expect(verbatimParts(note)).toEqual([
      'inlineCode:`span`',
      'link:[x *y*](https://x.test/a_(b))',
      'link:www.bare.org',
      'image:![p](p.png)',
      'linkReference:[r][]',
      'footnoteReference:[^1]',
      'html:<i>',
      'html:</i>',
      'code:```js\ncode\n```',
      'code:    more code',
      'definition:[r]: ./r.md',
    ]);
  });
});

describe('parseTasks', () => {
  it('reads task items with their lines, ticked or not, and leaves code and plain list items out', () => {
    const text = [
      '# Week',
      '',
      '- [ ] Draft the **permissions** proposal',
      '- [x] Alert on CDC lag',
      '- plain item',
      '',
      '```',
      '- [ ] in code',
      '```',
      '',
      '> 1. [X] in a quote',
      '- [ ] parent',
      '  - [ ] child with `code`',
    ].join('\r\n');
    expect(parseTasks(text)).toEqual([
      { line: 3, text: 'Draft the permissions proposal', done: false },
      { line: 4, text: 'Alert on CDC lag', done: true },
      { line: 11, text: 'in a quote', done: true },
      { line: 12, text: 'parent', done: false },
      { line: 13, text: 'child with code', done: false },
    ]);
  });

  it('cuts long tasks and gives up on notes past the limits', () => {
    const [task] = parseTasks(`- [ ] ${'word '.repeat(200)}`) ?? [];
    expect(task?.text).toHaveLength(MAX_TASK_TEXT);
    expect(task?.text.endsWith('…')).toBe(true);
    expect(parseTasks(`- [ ] x\n${']'.repeat(3_000)}`)).toBeNull();
  });
});

describe('math', () => {
  it('is no plain text, in a line or in a block, while a single dollar is', () => {
    const text = 'Atlas costs $5 and $$\\text{Atlas}^2$$ here\n\n$$\nAtlas = 1\n$$';
    expect(texts(text)).toEqual(['Atlas costs $5 and ', ' here']);
    expect(verbatimParts(text)).toEqual(['inlineMath:$$\\text{Atlas}^2$$', 'math:$$\nAtlas = 1\n$$']);
  });
});
