import { proseSpans, verbatimParts } from './prose';

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
      ' Atlas kickoff',
      'Plain words, ',
      'with emphasis',
      ', ',
      'strong',
      ' and ',
      'struck',
      '.',
      'A quote',
      ' over two lines',
      ' a task',
      'an item',
      '  that goes on',
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

  it('never lets a stretch cross a line break', () => {
    expect(texts('one\ntwo\n\nthree')).toEqual(['one', 'two', 'three']);
    expect(proseSpans('')).toEqual([]);
  });

  it('gets through notes that nest or repeat a mark tens of thousands of times', () => {
    const started = Date.now();
    for (const mark of ['[', '[[', '](', '`', '<', '*', '_', '> ', '- ', '|', '!', '\\']) {
      expect(() => proseSpans(mark.repeat(80_000))).not.toThrow();
    }
    // A fraction of a second on a laptop. The limit only has to catch work that grows with the square of the length.
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe('verbatimParts', () => {
  it('lists code, URLs and HTML in order, each as it is written', () => {
    const note = 'A `span`, [x](https://x.test/a_(b)) and <i>tag</i>.\n\n```js\ncode\n```\n\n    more code';
    expect(verbatimParts(note)).toEqual([
      '`span`',
      'https://x.test/a_(b)',
      '<i>',
      '</i>',
      '```js\ncode\n```',
      'more code',
    ]);
  });
});
