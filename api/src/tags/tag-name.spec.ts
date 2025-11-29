import { normalizeTagName, normalizeTagNames } from './tag-name';

describe('normalizeTagName', () => {
  it.each([
    ['Work', 'work'],
    ['  #Book Club ', 'book-club'],
    ['##todo', 'todo'],
    ['a,b', 'a-b'],
    ['multiple   spaces -- here', 'multiple-spaces-here'],
    ['-edge-', 'edge'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeTagName(input)).toBe(expected);
  });

  it('returns null for names with nothing left', () => {
    expect(normalizeTagName('  ')).toBeNull();
    expect(normalizeTagName('#')).toBeNull();
  });

  it('limits the length to 40 characters', () => {
    expect(normalizeTagName('x'.repeat(60))).toHaveLength(40);
  });
});

describe('normalizeTagNames', () => {
  it('drops duplicates and empty names, keeping the first occurrence order', () => {
    expect(normalizeTagNames(['Work', 'ideas', 'work', '', '#Ideas', 'later'])).toEqual(['work', 'ideas', 'later']);
  });
});
