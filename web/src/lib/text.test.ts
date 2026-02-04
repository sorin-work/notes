import { describe, expect, it } from 'vitest';
import { splitHighlights } from './text';

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
