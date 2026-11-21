import { describe, expect, it } from 'vitest';
import { needsRichMarkdown } from './useRichMarkdown';

describe('needsRichMarkdown', () => {
  it('is true for a block that names its language, or for $$ math', () => {
    expect(needsRichMarkdown('Intro\n\n```ts\nconst a = 1;\n```')).toBe(true);
    expect(needsRichMarkdown('> ~~~ python\n> x')).toBe(true);
    expect(needsRichMarkdown('Area $$\\pi r^2$$')).toBe(true);
  });

  it('is false for plain notes, plain code blocks and prices', () => {
    expect(needsRichMarkdown('Costs $5 or $10')).toBe(false);
    expect(needsRichMarkdown('```\nplain\n```')).toBe(false);
    expect(needsRichMarkdown('Use `code` inline')).toBe(false);
  });
});
