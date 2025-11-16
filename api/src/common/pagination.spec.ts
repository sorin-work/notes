import { PaginationQuery, skipFor } from './pagination';

describe('skipFor', () => {
  it('skips the pages before the requested one', () => {
    expect(skipFor(Object.assign(new PaginationQuery(), { page: 1, pageSize: 50 }))).toBe(0);
    expect(skipFor(Object.assign(new PaginationQuery(), { page: 3, pageSize: 20 }))).toBe(40);
  });

  it('defaults to the first page of 50', () => {
    const query = new PaginationQuery();
    expect(query).toMatchObject({ page: 1, pageSize: 50 });
    expect(skipFor(query)).toBe(0);
  });
});
