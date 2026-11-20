import { toPrefixQuery } from './search-query';

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
    expect(toPrefixQuery('"" " ! "')).toBeNull();
  });

  it('turns quoted words into a phrase without prefix matching', () => {
    expect(toPrefixQuery('"Weekly sync"')).toBe('(weekly <-> sync)');
    expect(toPrefixQuery('atlas "weekly sync" notes')).toBe('atlas:* & (weekly <-> sync) & notes:*');
    expect(toPrefixQuery('“data model” "sync"')).toBe('(data <-> model) & sync');
  });

  it('keeps only letters and digits inside a phrase too', () => {
    expect(toPrefixQuery('"a <-> b) | c:*"')).toBe('(a <-> b <-> c)');
  });

  it('treats a quote without a partner as ordinary words', () => {
    expect(toPrefixQuery('"weekly sy')).toBe('weekly:* & sy:*');
    expect(toPrefixQuery('"weekly sync" "atl')).toBe('(weekly <-> sync) & atl:*');
  });

  it('counts the words of a phrase towards the limit', () => {
    expect(toPrefixQuery('w1 w2 w3 w4 w5 w6 w7 w8 w9 w10 "w11 w12 w13" w14')).toBe(
      'w1:* & w2:* & w3:* & w4:* & w5:* & w6:* & w7:* & w8:* & w9:* & w10:* & (w11 <-> w12)',
    );
  });
});
