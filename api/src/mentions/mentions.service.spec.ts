import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaginationQuery } from '../common/pagination';
import { LinksService } from '../links/links.service';
import { MAX_CONTENT_LENGTH } from '../notes/dto/note.dto';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { VersionsService } from '../versions/versions.service';
import { lineAround, MAX_CANDIDATES, MAX_PARSED_LENGTH, MentionsService } from './mentions.service';

const USER = 'user-1';
const updatedAt = new Date('2026-01-10T09:00:00Z');
const target = {
  id: 'target',
  userId: USER,
  title: 'Project Atlas',
  content: '',
  deletedAt: null as Date | null,
  updatedAt,
};

function source(id: string, content: string, revision = 7) {
  return { id, userId: USER, title: `Note ${id}`, content, deletedAt: null, updatedAt, revision };
}

function page(overrides: Partial<PaginationQuery> = {}): PaginationQuery {
  return Object.assign(new PaginationQuery(), overrides);
}

describe('MentionsService', () => {
  let prisma: PrismaMock;
  let links: jest.Mocked<Pick<LinksService, 'sync' | 'titleTaken'>>;
  let versions: jest.Mocked<Pick<VersionsService, 'snapshot'>>;
  let service: MentionsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    links = { sync: jest.fn(), titleTaken: jest.fn().mockResolvedValue(false) };
    versions = { snapshot: jest.fn() };
    service = new MentionsService(
      asPrismaService(prisma),
      links as unknown as LinksService,
      versions as unknown as VersionsService,
    );
    prisma.note.findFirst.mockResolvedValue(target);
    // writeNoteText is an updateMany that says whether it found the note at the revision it was given.
    prisma.note.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => jest.restoreAllMocks());

  describe('list', () => {
    it('keeps the candidates that really mention the title, in the order the index gave them', async () => {
      const notes = [
        source('a', 'We talked about project atlas.\n\nAnd other things.'),
        source('b', 'Only in `Project Atlas` code.'),
        source('c', '# Plans\n\nIn `project atlas` code first, then Project Atlas ships in March.'),
      ];
      prisma.$queryRaw.mockResolvedValue([{ id: 'c' }, { id: 'b' }, { id: 'a' }]);
      prisma.note.findMany.mockResolvedValue(notes);

      const result = await service.list(USER, 'target', page());

      expect(result).toMatchObject({ total: 2, page: 1, pageSize: 50, capped: false });
      // Each one comes with the exact mention that "Link" would wrap, not just any place the words appear.
      expect(result.items).toEqual([
        {
          id: 'c',
          title: 'Note c',
          updatedAt,
          before: 'In project atlas code first, then ',
          match: 'Project Atlas',
          after: ' ships in March.',
          offset: notes[2].content.indexOf('Project Atlas'),
          version: 7,
        },
        {
          id: 'a',
          title: 'Note a',
          updatedAt,
          before: 'We talked about ',
          match: 'project atlas',
          after: '.',
          offset: 16,
          version: 7,
        },
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

    it('lists only a mention that "Link" would take, and goes past one it would not', async () => {
      // The first mention would make a reference link to the definition, the second a [[link]] in a link label.
      const refused = 'The project atlas.\n\n[project atlas]: https://x.test';
      const later = 'In [*Project Atlas*](x.md) first.\n\nThen project atlas.\n\nAnd Project Atlas.';
      prisma.$queryRaw.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prisma.note.findMany.mockResolvedValue([source('a', refused), source('b', later)]);

      const result = await service.list(USER, 'target', page());

      expect(result.items.map(({ id, offset, match }) => ({ id, offset, match }))).toEqual([
        { id: 'b', offset: later.indexOf('project atlas'), match: 'project atlas' },
      ]);
      // And "Link" takes what is listed.
      prisma.note.findFirst.mockResolvedValueOnce(target).mockResolvedValueOnce(source('b', later));
      await service.link(USER, 'target', 'b', { offset: result.items[0].offset, text: 'project atlas', version: 7 });
      expect(prisma.note.updateMany).toHaveBeenCalled();
    });

    it('stops parsing at its budget and says the list is capped, passing over notes without the title for free', async () => {
      const long = `Project Atlas. ${'word '.repeat(19_000)}`;
      const count = Math.ceil(MAX_PARSED_LENGTH / long.length) + 5;
      const ids = Array.from({ length: count }, (_, i) => ({ id: `n${i}` }));
      prisma.$queryRaw.mockResolvedValue(ids);
      prisma.note.findMany.mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in.map((id) =>
            source(id, id === 'n0' ? `Only stems: projects atlases. ${'word '.repeat(19_000)}` : long),
          ),
        ),
      );

      // The clock stands still, so only the budget of characters counts here.
      jest.spyOn(Date, 'now').mockReturnValue(0);
      const result = await service.list(USER, 'target', page());

      expect(result.capped).toBe(true);
      // n0 costs nothing, and every other note that fits the budget is listed.
      expect(result.total).toBe(Math.floor(MAX_PARSED_LENGTH / long.length));
      expect(result.items.map((mention) => mention.id)).not.toContain('n0');
    });

    it('stops parsing when its time is up and says the list is capped', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      prisma.note.findMany.mockResolvedValue(['a', 'b', 'c'].map((id) => source(id, 'About Project Atlas.')));
      let now = 0;
      // Each look at the clock is 400 ms later than the one before: the second note is still read, the third is not.
      jest.spyOn(Date, 'now').mockImplementation(() => (now += 400) - 400);

      const result = await service.list(USER, 'target', page());

      expect(result).toMatchObject({ total: 2, capped: true });
    });

    it.each([
      ['a short title', { ...target, title: 'Go' }],
      ['a title that cannot be written as a link', { ...target, title: 'C# notes' }],
      ['a note that is still called Untitled', { ...target, title: 'untitled' }],
      ['a note in the trash', { ...target, deletedAt: updatedAt }],
    ])('does not look for mentions of %s', async (_what, note) => {
      prisma.note.findFirst.mockResolvedValue(note);
      await expect(service.list(USER, 'target', page())).resolves.toMatchObject({ items: [], total: 0 });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('does not look for mentions of a title that another note has too', async () => {
      links.titleTaken.mockResolvedValue(true);
      await expect(service.list(USER, 'target', page())).resolves.toMatchObject({ items: [], total: 0 });
      // Asked about the other notes of this user, leaving this one out.
      expect(links.titleTaken).toHaveBeenCalledWith(
        USER,
        'Project Atlas',
        expect.objectContaining({ except: 'target' }),
      );
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
    const first = { offset: text.indexOf('project atlas'), text: 'project atlas', version: 7 };
    const second = { offset: text.indexOf('Project Atlas'), text: 'Project Atlas', version: 7 };

    function given(other: ReturnType<typeof source> | null, note = target) {
      prisma.note.findFirst.mockResolvedValueOnce(note).mockResolvedValueOnce(other);
    }
    const untouched = () => {
      expect(versions.snapshot).not.toHaveBeenCalled();
      expect(prisma.note.updateMany).not.toHaveBeenCalled();
      expect(links.sync).not.toHaveBeenCalled();
    };

    it('wraps the mention it is given, tied to the revision it read, and saves the old text as a version', async () => {
      const other = source('a', text);
      given(other);

      await service.link(USER, 'target', 'a', first);

      const linked = 'Intro.\n\nWe talked about [[project atlas]], and Project Atlas again.';
      expect(prisma.note.findFirst).toHaveBeenLastCalledWith({ where: { id: 'a', userId: USER, deletedAt: null } });
      // Only the text is written, so the edit time stays, and only while the note is still at that revision.
      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'a', userId: USER, revision: 7, deletedAt: null },
        data: { content: linked },
      });
      expect(versions.snapshot).toHaveBeenCalledWith(expect.anything(), other);
      expect(links.sync).toHaveBeenCalledWith(expect.anything(), 'a', linked);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('wraps the second mention when that is the one that was shown', async () => {
      given(source('a', text));
      await service.link(USER, 'target', 'a', second);
      expect(prisma.note.updateMany.mock.calls[0][0].data.content).toBe(
        'Intro.\n\nWe talked about project atlas, and [[Project Atlas]] again.',
      );
    });

    it('answers 409 and changes nothing when the note has another revision than the list saw', async () => {
      given(source('a', text, 8));
      await expect(service.link(USER, 'target', 'a', first)).rejects.toThrow('has changed since');
      untouched();
    });

    it('answers 409 when a save gets in between reading the note and writing the link', async () => {
      given(source('a', text));
      prisma.note.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.link(USER, 'target', 'a', first)).rejects.toThrow('has changed since');
      expect(versions.snapshot).not.toHaveBeenCalled();
      expect(links.sync).not.toHaveBeenCalled();
    });

    it('answers 409 when the place does not hold that mention, even for the right version', async () => {
      given(source('a', text));
      await expect(service.link(USER, 'target', 'a', { ...first, offset: first.offset + 1 })).rejects.toBeInstanceOf(
        ConflictException,
      );
      given(source('a', text));
      await expect(service.link(USER, 'target', 'a', { ...first, text: 'Project Atlas' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      untouched();
    });

    it('refuses when another note has the title, or the note is still called Untitled', async () => {
      given(source('a', text));
      links.titleTaken.mockResolvedValue(true);
      await expect(service.link(USER, 'target', 'a', first)).rejects.toThrow('Another note has the same title');
      // Asked inside the transaction, so that a note renamed a moment ago counts.
      expect(links.titleTaken).toHaveBeenCalledWith(USER, 'Project Atlas', { except: 'target', db: expect.anything() });

      links.titleTaken.mockResolvedValue(false);
      const untitled = 'A note called Untitled is mentioned.';
      given(source('a', untitled), { ...target, title: 'Untitled' });
      await expect(
        service.link(USER, 'target', 'a', { offset: 14, text: 'Untitled', version: 7 }),
      ).rejects.toBeInstanceOf(ConflictException);
      untouched();
    });

    it('refuses, with a reason, a note too long to look for mentions in', async () => {
      // Such a note is never listed either. The longest text a note can have is far beyond it.
      const full = `Project Atlas ${'x'.repeat(MAX_CONTENT_LENGTH - 16)}`;
      given(source('a', full));
      await expect(service.link(USER, 'target', 'a', { offset: 0, text: 'Project Atlas', version: 7 })).rejects.toThrow(
        new BadRequestException('That note is too long or too deeply nested to look for mentions in'),
      );
      untouched();
    });

    it('404s when the other note is not there, in the trash or of another user', async () => {
      given(null);
      await expect(service.link(USER, 'target', 'a', first)).rejects.toBeInstanceOf(NotFoundException);
      untouched();
    });

    it('refuses to link to a note in the trash', async () => {
      given(source('a', text), { ...target, deletedAt: updatedAt });
      await expect(service.link(USER, 'target', 'a', first)).rejects.toThrow('Restore the note from the trash');
      untouched();
    });
  });
});

describe('lineAround', () => {
  const around = (content: string, word: string, from = 0) => {
    const start = content.indexOf(word, from);
    return lineAround(content, start, start + word.length);
  };

  it('gives the line of the mention in three parts, without the marks of Markdown', () => {
    expect(around('First.\n\nThe **second** has Atlas in it, `and` more.\n\nThird.', 'Atlas')).toEqual({
      before: 'The second has ',
      match: 'Atlas',
      after: ' in it, and more.',
    });
    expect(around('# Atlas kickoff', 'Atlas')).toEqual({ before: '', match: 'Atlas', after: ' kickoff' });
    expect(around('- [ ] check the atlas today', 'atlas')).toEqual({
      before: 'check the ',
      match: 'atlas',
      after: ' today',
    });
  });

  it('shows the occurrence it is asked about, not an earlier one', () => {
    const content = 'Use `atlas` here, and then the Atlas itself.';
    expect(around(content, 'Atlas')).toEqual({
      before: 'Use atlas here, and then the ',
      match: 'Atlas',
      after: ' itself.',
    });
  });

  it('cuts long lines at a word on both sides', () => {
    const long = `${'word '.repeat(40)}Atlas${' more'.repeat(40)}`;
    const { before, after } = around(long, 'Atlas');
    expect(before).toMatch(/^…(word )+$/);
    expect(after).toMatch(/^( more)+…$/);
    expect(before.length).toBeLessThanOrEqual(81);
    expect(after.length).toBeLessThanOrEqual(81);
  });
});
