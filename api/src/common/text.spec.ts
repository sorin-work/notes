import { cleanSnippet, excerpt } from './text';

describe('excerpt', () => {
  it('leaves out a heading on the first line', () => {
    expect(excerpt('# Shopping\n\nMilk and eggs')).toBe('Milk and eggs');
  });

  it('strips formatting and list markers', () => {
    expect(excerpt('Some **bold** and _italic_ text\n\n- one\n* two\n1. first')).toBe(
      'Some bold and italic text one two first',
    );
  });

  it('reduces links to their text', () => {
    expect(excerpt('See [the docs](https://example.com), [[Other note]] and [[Target|this one]]')).toBe(
      'See the docs, Other note and this one',
    );
  });

  it('drops fenced code blocks and images', () => {
    expect(excerpt('Before\n\n```js\nconst x = 1;\n```\n\n![diagram](x.png) After')).toBe('Before After');
  });

  it('cuts long text at a word boundary', () => {
    const text = 'word '.repeat(100);
    const result = excerpt(text, 32);
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(33);
    expect(result).not.toMatch(/wor…$/);
  });

  it('returns an empty string for an empty note', () => {
    expect(excerpt('')).toBe('');
  });
});

describe('cleanSnippet', () => {
  it('removes table pipes, headings and emphasis markers but keeps highlight markers', () => {
    expect(cleanSnippet('| \u0002Index\u0003 | Good for |\n| --- | --- |\n## **B-tree**')).toBe(
      '\u0002Index\u0003 Good for B-tree',
    );
  });

  it('keeps underscores inside identifiers', () => {
    expect(cleanSnippet('`fact_orders` table')).toBe('fact_orders table');
  });
});
