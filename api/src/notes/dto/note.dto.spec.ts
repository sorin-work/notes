import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListNotesQuery } from './note.dto';

async function parse(query: Record<string, string>) {
  const dto = plainToInstance(ListNotesQuery, query);
  const errors = await validate(dto);
  return { dto, errors: errors.map((error) => error.property) };
}

describe('ListNotesQuery', () => {
  it('has defaults for paging and sorting', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ page: 1, pageSize: 50, sort: 'updated' });
  });

  it('turns query strings into numbers and booleans', async () => {
    const { dto, errors } = await parse({ page: '3', pageSize: '20', pinned: 'true', favorite: 'false' });
    expect(errors).toEqual([]);
    expect(dto).toMatchObject({ page: 3, pageSize: 20, pinned: true, favorite: false });
  });

  it('accepts a notebook id or "none"', async () => {
    expect((await parse({ notebookId: 'none' })).errors).toEqual([]);
    expect((await parse({ notebookId: '6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e' })).errors).toEqual([]);
    expect((await parse({ notebookId: '6F1D1C1E-8F7E-4A43-9A43-1F2A3B4C5D6E' })).errors).toEqual([]);
    expect((await parse({ notebookId: 'inbox' })).errors).toEqual(['notebookId']);
    // The services compare with "none" exactly, so no other spelling may get through.
    expect((await parse({ notebookId: 'NONE' })).errors).toEqual(['notebookId']);
  });

  it('rejects a tag with a null character, which the database cannot take', async () => {
    expect((await parse({ tag: 'atlas' })).errors).toEqual([]);
    expect((await parse({ tag: 'at\0las' })).errors).toEqual(['tag']);
  });

  it('rejects unknown sorts, page 0, pages beyond the limit and page sizes over 100', async () => {
    expect((await parse({ sort: 'size' })).errors).toEqual(['sort']);
    expect((await parse({ pageSize: '500' })).errors).toEqual(['pageSize']);
    expect((await parse({ page: '0' })).errors).toEqual(['page']);
    expect((await parse({ page: '100000' })).errors).toEqual([]);
    expect((await parse({ page: '100001' })).errors).toEqual(['page']);
    expect((await parse({ page: '9223372036854775807' })).errors).toEqual(['page']);
  });
});
