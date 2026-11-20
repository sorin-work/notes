import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaginationQuery } from '../common/pagination';
import { LinksService } from '../links/links.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { VersionsService } from '../versions/versions.service';
import { MAX_CANDIDATES, MentionsService, paragraphAround } from './mentions.service';

const USER = 'user-1';
const updatedAt = new Date('2026-01-10T09:00:00Z');
const target = { id: 'target', userId: USER, title: 'Project Atlas', content: '', deletedAt: null, updatedAt };

function source(id: string, content: string) {
  return { id, userId: USER, title: `Note ${id}`, content, deletedAt: null, updatedAt };
}

function page(overrides: Partial<PaginationQuery> = {}): PaginationQuery {
  return Object.assign(new PaginationQuery(), overrides);
}

describe('MentionsService', () => {
  let prisma: PrismaMock;
  let links: jest.Mocked<Pick<LinksService, 'sync'>>;
  let versions: jest.Mocked<Pick<VersionsService, 'snapshot'>>;
  let service: MentionsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    links = { sync: jest.fn() };
    versions = { snapshot: jest.fn() };
    service = new MentionsService(
      asPrismaService(prisma),
      links as unknown as LinksService,
      versions as unknown as VersionsService,
    );
    prisma.note.findFirst.mockResolvedValue(target);
  });

  describe('list', () => {
    it('keeps the candidates that really mention the title, in the order the index gave them', async () => {
      const notes = [
        source('a', 'We talked about project atlas.\n\nAnd other things.'),
        source('b', 'Only in `Project Atlas` code.'),
        source('c', '# Plans\n\nProject Atlas ships in March.'),
      ];
      prisma.$queryRaw.mockResolvedValue([{ id: 'c' }, { id: 'b' }, { id: 'a' }]);
      prisma.note.findMany.mockResolvedValue(notes);

      const result = await service.list(USER, 'target', page());

      expect(result).toMatchObject({ total: 2, page: 1, pageSize: 50, capped: false });
      expect(result.items).toEqual([
        { id: 'c', title: 'Note c', updatedAt, context: 'Project Atlas ships in March.' },
        { id: 'a', title: 'Note a', updatedAt, context: 'We talked about project atlas.' },
      ]);
      // The title and its key are parameters of the candidate query, and the notes are read as this user.
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([USER, 'target', 'Project Atlas', 'project atlas', 201]);
      expect(prisma.note.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['c', 'b', 'a'] },
        userId: USER,
        deletedAt: null,
      });
    });

    it('pages through the mentions it found', async () => {
      const notes = ['a', 'b', 'c'].map((id) => source(id, 'About Project Atlas.'));
      prisma.$queryRaw.mockResolvedValue(notes.map(({ id }) => ({ id })));
      prisma.note.findMany.mockResolvedValue(notes);

      const second = await service.list(USER, 'target', page({ page: 2, pageSize: 2 }));
      expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(second.items.map((mention) => mention.id)).toEqual(['c']);
    });

    it('reads no more than the limit of candidates, a batch at a time, and says so', async () => {
      const ids = Array.from({ length: MAX_CANDIDATES + 1 }, (_, i) => ({ id: `n${i}` }));
      prisma.$queryRaw.mockResolvedValue(ids);
      prisma.note.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.map((id) => source(id, 'Project Atlas'))),
      );

      const result = await service.list(USER, 'target', page({ pageSize: 10 }));

      expect(result).toMatchObject({ total: MAX_CANDIDATES, capped: true });
      expect(prisma.note.findMany).toHaveBeenCalledTimes(MAX_CANDIDATES / 25);
      const read = prisma.note.findMany.mock.calls.flatMap(([args]) => args.where.id.in as string[]);
      expect(read).toHaveLength(MAX_CANDIDATES);
      expect(read).not.toContain(`n${MAX_CANDIDATES}`);
    });

    it.each([
      ['a short title', { ...target, title: 'Go' }],
      ['a title that cannot be written as a link', { ...target, title: 'C# notes' }],
      ['a note in the trash', { ...target, deletedAt: updatedAt }],
    ])('does not look for mentions of %s', async (_what, note) => {
      prisma.note.findFirst.mockResolvedValue(note);
      await expect(service.list(USER, 'target', page())).resolves.toMatchObject({ items: [], total: 0 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('404s for a note of another user', async () => {
      prisma.note.findFirst.mockResolvedValue(null);
      await expect(service.list(USER, 'target', page())).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.note.findFirst).toHaveBeenCalledWith({ where: { id: 'target', userId: USER } });
    });
  });

  describe('link', () => {
    const text = 'Intro.\n\nWe talked about project atlas, and Project Atlas again.';

    it('wraps the first mention, saves a version first and leaves the edit time alone', async () => {
      const other = source('a', text);
      prisma.note.findFirst.mockResolvedValueOnce(target).mockResolvedValueOnce(other);

      await service.link(USER, 'target', 'a');

      const linked = 'Intro.\n\nWe talked about [[project atlas]], and Project Atlas again.';
      expect(prisma.note.findFirst).toHaveBeenLastCalledWith({ where: { id: 'a', userId: USER, deletedAt: null } });
      expect(versions.snapshot).toHaveBeenCalledWith(expect.anything(), other);
      expect(prisma.note.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { content: linked } });
      expect(links.sync).toHaveBeenCalledWith(expect.anything(), 'a', linked);
      // All of it inside one transaction, after the row was locked.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE');
      expect(versions.snapshot.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.note.update.mock.invocationCallOrder[0],
      );
    });

    it('changes nothing when the mention is gone', async () => {
      prisma.note.findFirst.mockResolvedValueOnce(target).mockResolvedValueOnce(source('a', 'See [[Project Atlas]].'));
      await expect(service.link(USER, 'target', 'a')).rejects.toBeInstanceOf(ConflictException);
      expect(versions.snapshot).not.toHaveBeenCalled();
      expect(prisma.note.update).not.toHaveBeenCalled();
    });

    it('404s when the other note is not there, in the trash or of another user', async () => {
      prisma.note.findFirst.mockResolvedValueOnce(target).mockResolvedValueOnce(null);
      await expect(service.link(USER, 'target', 'a')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.note.update).not.toHaveBeenCalled();
    });

    it('refuses to link to a note in the trash', async () => {
      prisma.note.findFirst.mockResolvedValue({ ...target, deletedAt: updatedAt });
      await expect(service.link(USER, 'target', 'a')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});

describe('paragraphAround', () => {
  it('returns the paragraph a position falls in, without its Markdown', () => {
    const content = 'First one.\n\nThe **second** paragraph\nhas two lines.\r\n\r\nThird.';
    expect(paragraphAround(content, 0)).toBe('First one.');
    expect(paragraphAround(content, content.indexOf('two'))).toBe('The second paragraph has two lines.');
    expect(paragraphAround(content, content.indexOf('Third'))).toBe('Third.');
  });
});
