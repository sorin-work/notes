import { describe, expect, it } from 'vitest';
import { countLines, dueDay, toggleTask } from './tasks';

describe('toggleTask', () => {
  it('ticks and unticks the box on the given line only', () => {
    const text = '# Shopping\n\n- [ ] Oat milk\n- [x] Lemons\n- [X] Flour';
    expect(toggleTask(text, 3, false)).toBe('# Shopping\n\n- [x] Oat milk\n- [x] Lemons\n- [X] Flour');
    expect(toggleTask(text, 4, true)).toBe('# Shopping\n\n- [ ] Oat milk\n- [ ] Lemons\n- [X] Flour');
    expect(toggleTask(text, 5, true)).toBe('# Shopping\n\n- [ ] Oat milk\n- [x] Lemons\n- [ ] Flour');
  });

  it.each([
    ['  * [ ] nested', '  * [x] nested'],
    ['+ [x] plus', '+ [ ] plus'],
    ['10. [ ] ordered', '10. [x] ordered'],
    ['1) [x] ordered', '1) [ ] ordered'],
    ['> - [ ] quoted', '> - [x] quoted'],
    ['- - [ ] list in a list', '- - [x] list in a list'],
    ['-\t[\t] tabs', '-\t[x] tabs'],
    ['- [x]', '- [ ]'],
  ])('understands %j', (before, after) => {
    expect(toggleTask(before, 1, before.includes('[x]'))).toBe(after);
  });

  it('leaves boxes in the text of the item alone', () => {
    expect(toggleTask('- [ ] write [x] for done and [ ] for open', 1, false)).toBe(
      '- [x] write [x] for done and [ ] for open',
    );
  });

  it('changes nothing when the line has no box or does not exist', () => {
    const text = '- [ ] one\nplain [ ] text\n- [[x]] a link\n-\n  [ ] box on the next line';
    for (const line of [0, 2, 3, 4, 6]) {
      expect(toggleTask(text, line, false)).toBe(text);
    }
  });

  it('changes nothing when the box is not in the state that was clicked', () => {
    expect(toggleTask('- [x] done', 1, false)).toBe('- [x] done');
    expect(toggleTask('- [ ] open', 1, true)).toBe('- [ ] open');
  });

  it('does not take a link definition for a box', () => {
    const text = '- [x]: https://example.com/spec\n  [ ] read the spec';
    expect(toggleTask(text, 1, false)).toBe(text);
    expect(toggleTask(text, 1, true)).toBe(text);
    expect(toggleTask('- [x](https://example.com) a link', 1, true)).toBe('- [x](https://example.com) a link');
  });

  it('counts lines the way the parser does and keeps the line endings', () => {
    expect(toggleTask('one\r\n\r\n- [ ] a\r\n- [ ] b\r\n', 4, false)).toBe('one\r\n\r\n- [ ] a\r\n- [x] b\r\n');
    expect(toggleTask('one\r- [ ] a\r- [ ] b', 3, false)).toBe('one\r- [ ] a\r- [x] b');
  });
});

describe('countLines', () => {
  it('counts \\r\\n as one line ending and a lone \\r or \\n as one each', () => {
    expect(countLines('')).toBe(1);
    expect(countLines('a\r\nb\rc\nd')).toBe(4);
    expect(countLines('a\n\r\n\r')).toBe(4);
  });
});

describe('dueDay', () => {
  it('reads due: and a real day written after a task', () => {
    expect(dueDay('Send the report due:2026-11-30')).toBe('2026-11-30');
    expect(dueDay('due:2026-01-05 call Dana')).toBe('2026-01-05');
    expect(dueDay('Send it overdue:2026-11-30')).toBeNull();
    expect(dueDay('Send it due:2026-02-30')).toBeNull();
    expect(dueDay('Send it due:2026-11-3')).toBeNull();
  });
});
