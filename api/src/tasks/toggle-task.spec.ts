import { toggleTask } from './toggle-task';

describe('toggleTask', () => {
  it('flips the box on that line when it shows the state that was clicked', () => {
    const text = '# Plan\r\n- [ ] one\r\n- [x] two';
    expect(toggleTask(text, 2, false)).toBe('# Plan\r\n- [x] one\r\n- [x] two');
    expect(toggleTask(text, 3, true)).toBe('# Plan\r\n- [ ] one\r\n- [ ] two');
  });

  it('leaves the text alone when the line holds no box in that state', () => {
    const text = '- [ ] one\n[x]: https://example.com\nplain';
    expect(toggleTask(text, 1, true)).toBe(text);
    expect(toggleTask(text, 2, true)).toBe(text);
    expect(toggleTask(text, 3, false)).toBe(text);
    expect(toggleTask(text, 9, false)).toBe(text);
  });
});
