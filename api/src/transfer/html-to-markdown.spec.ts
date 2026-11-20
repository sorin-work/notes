import { closeSelfClosing, htmlToMarkdown } from './html-to-markdown';

describe('closeSelfClosing', () => {
  it('writes out self-closing tags as an opening and a closing tag, leaving void ones and quoted ">" alone', () => {
    expect(closeSelfClosing('<div><en-todo checked="true"/>Done</div>')).toBe(
      '<div><en-todo checked="true"></en-todo>Done</div>',
    );
    expect(closeSelfClosing('a<br/>b<img src="x"/><en-media hash="a>b" />')).toBe(
      'a<br/>b<img src="x"/><en-media hash="a>b" ></en-media>',
    );
    expect(closeSelfClosing('1 < 2 and <b>bold</b> <x')).toBe('1 < 2 and <b>bold</b> <x');
  });

  it('takes time in proportion to the input, also on input made to be slow', () => {
    const hostile = [
      `<a${' '.repeat(4_000_000)}`,
      '<a '.repeat(1_400_000),
      `<a "${'<'.repeat(4_000_000)}`,
      '<a/ '.repeat(1_000_000),
    ];
    for (const input of hostile) {
      const started = Date.now();
      closeSelfClosing(input);
      expect(Date.now() - started).toBeLessThan(2_000);
    }
  });
});

describe('htmlToMarkdown', () => {
  it('keeps the text after an empty Evernote element', () => {
    expect(htmlToMarkdown('<en-note><div><en-todo/>Open</div><en-media hash="x"/><div>after</div></en-note>')).toBe(
      '[ ] Open\n\nafter',
    );
  });
});
