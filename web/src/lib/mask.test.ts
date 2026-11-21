import { describe, expect, it } from 'vitest';
import { maskNonProse } from './mask';

/** What is left of a note to look for links in, blanked characters shown as dots, spaces and line endings kept. */
const left = (text: string) =>
  [...maskNonProse(text)].map((char, index) => (char === ' ' && text[index] !== ' ' ? '.' : char)).join('');

// The same cases as api/src/links/mask.spec.ts: the two copies of maskNonProse must agree.
describe('maskNonProse', () => {
  it('blanks math that runs over a line ending inside a paragraph', () => {
    expect(left('see $$a + [[Note]]\nb$$ here [[After]]')).toBe('see ... . ........\n... here [[After]]');
  });

  it('keeps a block of math open past a line that only starts with $$', () => {
    expect(left('$$\n[[x]]\n$$ x\n$$\n[[After]]')).toBe('..\n.....\n.. .\n..\n[[After]]');
  });

  it('closes a $$$ block only on a line of three $ or more', () => {
    expect(left('$$$\n[[x]]\n$$\n[[still]]\n$$$$\n[[After]]')).toBe('...\n.....\n..\n.........\n....\n[[After]]');
  });

  it('leaves single dollars, escaped dollars and math cut by a blank line alone', () => {
    expect(left('Costs $5 at [[Shop]], or $10')).toBe('Costs $5 at [[Shop]], or $10');
    expect(left('a \\$$[[b]]$$')).toBe('a \\$$[[b]]$$');
    expect(left('open $$ here\n\n[[After]] $$')).toBe('open $$ here\n\n[[After]] $$');
  });

  it('blanks code spans, also over a line ending, and fenced code up to a real closing fence', () => {
    expect(left('a `[[c]]` b ``x\n[[y]]`` [[z]]')).toBe('a ....... b ...\n....... [[z]]');
    expect(left('```js\n[[in]]\n```x\n[[still]]\n```\n[[out]]')).toBe('.....\n......\n....\n.........\n...\n[[out]]');
  });

  it('keeps the length and every line ending', () => {
    const text = 'a $$x\r\ny$$ b\r```\r[[c]]\r```';
    expect(maskNonProse(text)).toHaveLength(text.length);
    expect(maskNonProse(text).match(/\r\n?|\n/g)).toEqual(text.match(/\r\n?|\n/g));
  });
});
