import { describe, expect, it } from 'vitest';
import { joinPages } from './pages';

describe('joinPages', () => {
  it('puts the pages one after the other and drops what an earlier page already had', () => {
    const pages = [{ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'c' }] }];
    expect(joinPages(pages)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });

  it('is empty before the first page has arrived', () => {
    expect(joinPages(undefined)).toEqual([]);
  });
});
