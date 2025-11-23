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
    expect((await parse({ notebookId: 'inbox' })).errors).toEqual(['notebookId']);
  });

  it('rejects unknown sorts, page 0 and page sizes over 100', async () => {
    expect((await parse({ sort: 'size' })).errors).toEqual(['sort']);
    expect((await parse({ pageSize: '500' })).errors).toEqual(['pageSize']);
    expect((await parse({ page: '0' })).errors).toEqual(['page']);
  });
});
