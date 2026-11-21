import { describe, expect, it } from 'vitest';
import { createSlugger, findHeading, headingLinkText, lineOffset, noteHeadings, slugFromHash, slugify } from './headings';

describe('slugify', () => {
  it('makes the slug GitHub makes', () => {
    expect(slugify('Next steps')).toBe('next-steps');
    expect(slugify('What? Why! (2026)')).toBe('what-why-2026');
    expect(slugify('snake_case and kebab-case')).toBe('snake_case-and-kebab-case');
    expect(slugify('Café Müller')).toBe('café-müller');
    expect(slugify('  two  spaces ')).toBe('--two--spaces-');
  });

  it('numbers repeats from 1', () => {
    const slug = createSlugger();
    expect(['Intro', 'Intro', 'Intro-1', 'Intro'].map(slug)).toEqual(['intro', 'intro-1', 'intro-1-1', 'intro-2']);
  });
});

describe('noteHeadings', () => {
  it('reads ATX and Setext headings with their lines, and no # line in code', () => {
    const text = [
      '# Plan',
      '',
      '```',
      '# not a heading',
      '```',
      '',
      'Done',
      '====',
      '',
      '    # indented code',
      '',
      '> ## In a quote',
      '- ### In a list',
      '#no space',
    ].join('\n');
    expect(noteHeadings(text)).toEqual([
      { depth: 1, text: 'Plan', line: 1, slug: 'plan' },
      { depth: 1, text: 'Done', line: 7, slug: 'done' },
      { depth: 2, text: 'In a quote', line: 12, slug: 'in-a-quote' },
      { depth: 3, text: 'In a list', line: 13, slug: 'in-a-list' },
    ]);
  });

  it('takes the words the preview shows, links and code included', () => {
    expect(noteHeadings('## See [[Atlas|the project]] and `code`\r\n## *Notes*')).toEqual([
      { depth: 2, text: 'See the project and code', line: 1, slug: 'see-the-project-and-code' },
      { depth: 2, text: 'Notes', line: 2, slug: 'notes' },
    ]);
  });

  it('gives repeated headings their numbers', () => {
    expect(noteHeadings('# Day\n# Day').map((heading) => heading.slug)).toEqual(['day', 'day-1']);
  });
});

describe('findHeading and headingLinkText', () => {
  const headings = noteHeadings('# Next steps\n# Intro\n# Intro\n# A | B');

  it('finds a heading by its words or its slug', () => {
    expect(findHeading(headings, 'Next Steps')?.line).toBe(1);
    expect(findHeading(headings, 'next-steps')?.line).toBe(1);
    expect(findHeading(headings, 'intro-1')?.line).toBe(3);
    expect(findHeading(headings, 'Gone')).toBeUndefined();
  });

  it('writes the words where they lead back, else the slug', () => {
    expect(headings.map((heading) => headingLinkText(heading, headings))).toEqual([
      'Next steps',
      'Intro',
      'intro-1',
      'a--b',
    ]);
  });
});

describe('slugFromHash and lineOffset', () => {
  it('reads the slug of a heading address', () => {
    expect(slugFromHash('#h-next-steps')).toBe('next-steps');
    expect(slugFromHash('#h-caf%C3%A9')).toBe('café');
    expect(slugFromHash('#note')).toBeNull();
    expect(slugFromHash('#h-%E0%A4%A')).toBeNull();
  });

  it('finds where a line starts with any line ending', () => {
    const text = 'a\r\nb\rc\nd';
    expect([1, 2, 3, 4, 9].map((line) => lineOffset(text, line))).toEqual([0, 3, 5, 7, 8]);
  });
});
