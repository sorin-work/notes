import { describe, expect, it } from 'vitest';
import { toggleTask } from './tasks';

describe('toggleTask', () => {
  it('ticks and unticks the box on the given line only', () => {
    const text = '# Shopping\n\n- [ ] Oat milk\n- [x] Lemons\n- [X] Flour';
    expect(toggleTask(text, 3)).toBe('# Shopping\n\n- [x] Oat milk\n- [x] Lemons\n- [X] Flour');
    expect(toggleTask(text, 4)).toBe('# Shopping\n\n- [ ] Oat milk\n- [ ] Lemons\n- [X] Flour');
    expect(toggleTask(text, 5)).toBe('# Shopping\n\n- [ ] Oat milk\n- [x] Lemons\n- [ ] Flour');
  });

  it.each([
    ['  * [ ] nested', '  * [x] nested'],
    ['+ [x] plus', '+ [ ] plus'],
    ['10. [ ] ordered', '10. [x] ordered'],
    ['1) [x] ordered', '1) [ ] ordered'],
    ['> - [ ] quoted', '> - [x] quoted'],
    ['- - [ ] list in a list', '- - [x] list in a list'],
    ['-\t[\t] tabs', '-\t[x] tabs'],
  ])('understands %j', (before, after) => {
    expect(toggleTask(before, 1)).toBe(after);
  });

  it('leaves boxes in the text of the item alone', () => {
    expect(toggleTask('- [ ] write [x] for done and [ ] for open', 1)).toBe(
      '- [x] write [x] for done and [ ] for open',
    );
  });

  it('changes nothing when the line has no box or does not exist', () => {
    const text = '- [ ] one\nplain [ ] text\n- [[x]] a link\n-\n  [ ] box on the next line';
    for (const line of [0, 2, 3, 4, 6]) {
      expect(toggleTask(text, line)).toBe(text);
    }
  });

  it('counts lines the way the parser does and keeps the line endings', () => {
    expect(toggleTask('one\r\n\r\n- [ ] a\r\n- [ ] b\r\n', 4)).toBe('one\r\n\r\n- [ ] a\r\n- [x] b\r\n');
    expect(toggleTask('one\r- [ ] a\r- [ ] b', 3)).toBe('one\r- [ ] a\r- [x] b');
  });
});
