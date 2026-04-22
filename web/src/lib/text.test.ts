import { describe, expect, it } from 'vitest';
import { countWords, readingMinutes, splitHighlights } from './text';

describe('countWords', () => {
  it('counts words, ignoring Markdown punctuation', () => {
    expect(countWords('# Title\n\n- one **two** three\n\n| a | b |')).toBe(6);
    expect(countWords('')).toBe(0);
    expect(countWords('--- *** ###')).toBe(0);
  });
});

describe('readingMinutes', () => {
  it('rounds to whole minutes with a minimum of one', () => {
    expect(readingMinutes(0)).toBe(0);
    expect(readingMinutes(10)).toBe(1);
    expect(readingMinutes(1000)).toBe(5);
  });
});

describe('splitHighlights', () => {
  it('splits on the highlight markers', () => {
    expect(splitHighlights('The \u0002weekly\u0003 sync on \u0002Tuesday\u0003')).toEqual([
      { text: 'The ', highlight: false },
      { text: 'weekly', highlight: true },
      { text: ' sync on ', highlight: false },
      { text: 'Tuesday', highlight: true },
    ]);
  });

  it('treats text without markers as plain', () => {
    expect(splitHighlights('plain')).toEqual([{ text: 'plain', highlight: false }]);
    expect(splitHighlights('broken \u0002marker')).toEqual([
      { text: 'broken ', highlight: false },
      { text: 'marker', highlight: false },
    ]);
  });
});
