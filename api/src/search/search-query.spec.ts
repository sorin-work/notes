import { parseSearch, toPrefixQuery } from './search-query';

describe('toPrefixQuery', () => {
  it('matches every word as a prefix', () => {
    expect(toPrefixQuery('weekly meet')).toBe('weekly:* & meet:*');
  });

  it('drops punctuation and tsquery operators', () => {
    expect(toPrefixQuery("rust's & (ownership) | !borrow")).toBe('rust:* & s:* & ownership:* & borrow:*');
  });

  it('keeps letters outside ASCII', () => {
    expect(toPrefixQuery('Pastéis Belém')).toBe('pastéis:* & belém:*');
  });

  it('removes duplicates and limits the number of words', () => {
    expect(toPrefixQuery('a a a')).toBe('a:*');
    expect(toPrefixQuery('w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 w11 w12 w13 w14')?.split(' & ')).toHaveLength(12);
  });

  it('returns null when nothing searchable is left', () => {
    expect(toPrefixQuery('')).toBeNull();
    expect(toPrefixQuery('  ?! %% ')).toBeNull();
  });
});

describe('parseSearch', () => {
  it('keeps loose words as prefixes and quoted words as phrases', () => {
    expect(parseSearch('weekly meet')).toEqual({ prefix: 'weekly:* & meet:*', phrases: [] });
    expect(parseSearch('"Weekly sync"')).toEqual({ prefix: null, phrases: ['Weekly sync'] });
    expect(parseSearch('atlas "weekly sync" notes “data model”')).toEqual({
      prefix: 'atlas:* & notes:*',
      phrases: ['weekly sync', 'data model'],
    });
  });

  it('passes a phrase on as it was typed, for Postgres to split', () => {
    expect(parseSearch('"node.js today" "3.5 mm"')?.phrases).toEqual(['node.js today', '3.5 mm']);
    expect(parseSearch('"a <-> b) | c:*"')).toEqual({ prefix: null, phrases: ['a <-> b) | c:*'] });
  });

  it('takes control characters out of a phrase', () => {
    expect(parseSearch('"weekly\u0000\tsync"')?.phrases).toEqual(['weekly sync']);
  });

  it('treats a quote without a partner as ordinary words', () => {
    expect(parseSearch('"weekly sy')).toEqual({ prefix: 'weekly:* & sy:*', phrases: [] });
    expect(parseSearch('"weekly sync" "atl')).toEqual({ prefix: 'atl:*', phrases: ['weekly sync'] });
  });

  it('drops empty and repeated phrases and limits their number', () => {
    expect(parseSearch('"" " ! " "a" "a"')).toEqual({ prefix: null, phrases: ['a'] });
    expect(parseSearch('"a" "b" "c" "d" "e" "f" "g"')?.phrases).toHaveLength(5);
  });

  it('returns null when nothing searchable is left', () => {
    expect(parseSearch('')).toBeNull();
    expect(parseSearch('"" " ! " ?!')).toBeNull();
  });
});
