import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { depthOf, heightOf, isInside, MAX_NOTEBOOK_DEPTH, NotebooksService } from './notebooks.service';

const USER = 'user-1';
const now = new Date('2026-02-01T10:00:00Z');

function notebook(id: string, overrides: Partial<{ name: string; parentId: string | null }> = {}) {
  return {
    id,
    userId: USER,
    name: id,
    parentId: null,
    createdAt: now,
    updatedAt: now,
    share: null as { expiresAt: Date | null } | null,
    parent: null as { id: string; name: string; share: { expiresAt: Date | null } | null } | null,
    ...overrides,
  };
}

/** What the service reads to know the shape of the tree: every notebook with its parent. */
function shape(...notebooks: [id: string, parentId: string | null][]) {
  return notebooks.map(([id, parentId]) => ({ id, parentId }));
}

describe('NotebooksService', () => {
  let prisma: PrismaMock;
  let service: NotebooksService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new NotebooksService(asPrismaService(prisma));
    prisma.note.groupBy.mockResolvedValue([]);
  });

  describe('list', () => {
    it('returns notebooks with the number of their notes and, apart, of their templates', async () => {
      prisma.notebook.findMany.mockResolvedValue([
        { ...notebook('work'), _count: { notes: 3 } },
        { ...notebook('home'), _count: { notes: 0 } },
      ]);
      prisma.note.groupBy.mockResolvedValue([{ notebookId: 'home', _count: { _all: 1 } }]);
      const result = await service.list(USER);
      expect(result).toEqual([
        {
          id: 'work',
          name: 'work',
          parentId: null,
          createdAt: now,
          updatedAt: now,
          noteCount: 3,
          templateCount: 0,
          shared: false,
          sharedThrough: null,
        },
        {
          id: 'home',
          name: 'home',
          parentId: null,
          createdAt: now,
          updatedAt: now,
          noteCount: 0,
          templateCount: 1,
          shared: false,
          sharedThrough: null,
        },
      ]);
      expect(prisma.note.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER, deletedAt: null, isTemplate: true, notebookId: { not: null } },
        }),
      );
      expect(prisma.notebook.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER },
          include: expect.objectContaining({
            _count: { select: { notes: { where: { deletedAt: null, isTemplate: false } } } },
          }),
        }),
      );
    });

    it('says which shared notebook makes a notebook public: its own link, or that of the one it is inside', async () => {
      const shared = { expiresAt: null };
      const runOut = { expiresAt: new Date(Date.now() - 1000) };
      prisma.notebook.findMany.mockResolvedValue([
        { ...notebook('recipes', { name: 'Recipes' }), share: shared, _count: { notes: 1 } },
        {
          ...notebook('bread', { name: 'Bread', parentId: 'recipes' }),
          parent: { id: 'recipes', name: 'Recipes', share: shared },
          _count: { notes: 1 },
        },
        { ...notebook('old', { name: 'Old' }), share: runOut, _count: { notes: 0 } },
        { ...notebook('work', { name: 'Work' }), _count: { notes: 0 } },
      ]);
      const result = await service.list(USER);
      expect(result.map(({ id, shared, sharedThrough }) => [id, shared, sharedThrough])).toEqual([
        ['recipes', true, { id: 'recipes', name: 'Recipes' }],
        ['bread', false, { id: 'recipes', name: 'Recipes' }],
        // A link that has run out lets nobody in.
        ['old', true, null],
        ['work', false, null],
      ]);
    });

    it('finds the shared notebook three levels up, and the nearest one when there are two', async () => {
      const shared = { expiresAt: null };
      const recipes = { id: 'recipes', name: 'Recipes', share: shared, parent: null };
      const bread = { id: 'bread', name: 'Bread', share: null, parent: recipes };
      const rye = { id: 'rye', name: 'Rye', share: shared, parent: bread };
      prisma.notebook.findMany.mockResolvedValue([
        { ...notebook('old-rye', { name: 'Old rye', parentId: 'rye' }), parent: rye, _count: { notes: 0 } },
        { ...notebook('sour', { name: 'Sour', parentId: 'bread' }), parent: bread, _count: { notes: 0 } },
        {
          ...notebook('starter', { name: 'Starter', parentId: 'sour' }),
          parent: { id: 'sour', name: 'Sour', share: null, parent: bread },
          _count: { notes: 0 },
        },
      ]);
      const result = await service.list(USER);
      expect(result.map(({ id, sharedThrough }) => [id, sharedThrough?.id ?? null])).toEqual([
        ['old-rye', 'rye'],
        ['sour', 'recipes'],
        ['starter', 'recipes'],
      ]);
      // The parents are read as far up as notebooks nest.
      const include = prisma.notebook.findMany.mock.calls[0][0].include;
      expect(include.parent.select.parent.select.parent.select).toMatchObject({ id: true, share: expect.anything() });
    });
  });

  describe('create', () => {
    it('creates a top-level notebook', async () => {
      prisma.notebook.findMany.mockResolvedValue([]);
      prisma.notebook.findFirst.mockResolvedValue(null);
      prisma.notebook.create.mockResolvedValue({ ...notebook('new', { name: 'Ideas' }), _count: { notes: 0 } });
      const result = await service.create(USER, { name: 'Ideas' });
      expect(prisma.notebook.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: USER, name: 'Ideas', parentId: null } }),
      );
      expect(result).toMatchObject({ name: 'Ideas', noteCount: 0 });
      expect(result).not.toHaveProperty('userId');
    });

    it('nests a notebook inside another, down to the fourth level', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['a', null], ['b', 'a'], ['c', 'b']));
      prisma.notebook.findFirst.mockResolvedValue(null);
      prisma.notebook.create.mockResolvedValue({ ...notebook('d', { parentId: 'c' }), _count: { notes: 0 } });
      await service.create(USER, { name: 'Deep', parentId: 'c' });
      expect(prisma.notebook.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: USER, name: 'Deep', parentId: 'c' } }),
      );
    });

    it('does not nest deeper than that', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['a', null], ['b', 'a'], ['c', 'b'], ['d', 'c']));
      await expect(service.create(USER, { name: 'Deeper', parentId: 'd' })).rejects.toThrow(
        'Notebooks can be nested 4 levels deep at most',
      );
      expect(prisma.notebook.create).not.toHaveBeenCalled();
      expect(MAX_NOTEBOOK_DEPTH).toBe(4);
    });

    it('404s for a parent that belongs to someone else', async () => {
      // The shape only holds this user's notebooks.
      prisma.notebook.findMany.mockResolvedValue(shape(['mine', null]));
      await expect(service.create(USER, { name: 'X', parentId: 'theirs' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.notebook.findMany).toHaveBeenCalledWith({
        where: { userId: USER },
        select: { id: true, parentId: true },
      });
    });

    it('refuses a duplicate name next to an existing notebook, ignoring case', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['work', null]));
      prisma.notebook.findFirst.mockResolvedValue(notebook('work', { name: 'Work' }));
      await expect(service.create(USER, { name: 'work' })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.notebook.findFirst).toHaveBeenCalledWith({
        where: { userId: USER, parentId: null, name: { equals: 'work', mode: 'insensitive' } },
      });
    });

    it('checks and creates inside one transaction, after taking the lock on the tree', async () => {
      prisma.notebook.findMany.mockResolvedValue([]);
      prisma.notebook.findFirst.mockResolvedValue(null);
      prisma.notebook.create.mockResolvedValue({ ...notebook('new'), _count: { notes: 0 } });
      await service.create(USER, { name: 'new' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const [lock, user] = prisma.$queryRaw.mock.calls[0] as [string[], string];
      expect(lock.join('?')).toContain('FROM users WHERE id = ?::uuid FOR NO KEY UPDATE');
      expect(user).toBe(USER);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.notebook.findMany.mock.invocationCallOrder[0],
      );
    });
  });

  describe('findOrCreatePath', () => {
    it('takes the lock, then finds or makes each level from the top down', async () => {
      prisma.notebook.findFirst.mockResolvedValueOnce({ id: 'work' }).mockResolvedValue(null);
      prisma.notebook.create.mockResolvedValueOnce({ id: 'meetings' }).mockResolvedValueOnce({ id: 'monday' });

      const result = await service.findOrCreatePath(asPrismaService(prisma), USER, ['Work', 'Meetings', 'Monday']);

      expect(result).toEqual({ id: 'monday', created: 2 });
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.notebook.findFirst.mock.invocationCallOrder[0],
      );
      expect(prisma.notebook.findFirst.mock.calls[0][0].where).toEqual({
        userId: USER,
        parentId: null,
        name: { equals: 'Work', mode: 'insensitive' },
      });
      expect(prisma.notebook.create.mock.calls[1][0].data).toEqual({
        userId: USER,
        parentId: 'meetings',
        name: 'Monday',
      });
    });

    it('refuses a path deeper than notebooks nest, and does nothing for an empty one', async () => {
      await expect(
        service.findOrCreatePath(asPrismaService(prisma), USER, ['a', 'b', 'c', 'd', 'e']),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.findOrCreatePath(asPrismaService(prisma), USER, [])).resolves.toEqual({
        id: null,
        created: 0,
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(prisma.notebook.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const withCount = (nb: ReturnType<typeof notebook>) => ({ ...nb, _count: { notes: 0 } });

    it('renames a notebook', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['work', null]));
      prisma.notebook.findFirst.mockResolvedValueOnce(notebook('work', { name: 'Work' })).mockResolvedValueOnce(null);
      prisma.notebook.findFirstOrThrow.mockResolvedValue(withCount(notebook('work', { name: 'Job' })));
      const result = await service.update(USER, 'work', { name: 'Job' });
      expect(prisma.notebook.update).toHaveBeenCalledWith({
        where: { id: 'work' },
        data: { name: 'Job', parentId: null },
      });
      expect(result.name).toBe('Job');
    });

    it('allows changing only the case of the name', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['work', null]));
      prisma.notebook.findFirst.mockResolvedValueOnce(notebook('work', { name: 'work' })).mockResolvedValueOnce(null);
      prisma.notebook.findFirstOrThrow.mockResolvedValue(withCount(notebook('work', { name: 'Work' })));
      await service.update(USER, 'work', { name: 'Work' });
      expect(prisma.notebook.findFirst).toHaveBeenLastCalledWith({
        where: { userId: USER, parentId: null, name: { equals: 'Work', mode: 'insensitive' }, id: { not: 'work' } },
      });
    });

    it('moves a nested notebook back to the top level', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['work', null], ['meetings', 'work']));
      prisma.notebook.findFirst
        .mockResolvedValueOnce(notebook('meetings', { parentId: 'work' }))
        .mockResolvedValueOnce(null);
      prisma.notebook.findFirstOrThrow.mockResolvedValue(withCount(notebook('meetings')));
      await service.update(USER, 'meetings', { parentId: null });
      expect(prisma.notebook.update).toHaveBeenCalledWith({
        where: { id: 'meetings' },
        data: { name: 'meetings', parentId: null },
      });
    });

    it('moves a notebook together with the notebooks inside it', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['work', null], ['meetings', 'work'], ['personal', null]));
      prisma.notebook.findFirst.mockResolvedValueOnce(notebook('work')).mockResolvedValueOnce(null);
      prisma.notebook.findFirstOrThrow.mockResolvedValue(withCount(notebook('work', { parentId: 'personal' })));
      await service.update(USER, 'work', { parentId: 'personal' });
      // Only the notebook that moves is written. What is inside it hangs on it and comes along.
      expect(prisma.notebook.update).toHaveBeenCalledTimes(1);
      expect(prisma.notebook.update).toHaveBeenCalledWith({
        where: { id: 'work' },
        data: { name: 'work', parentId: 'personal' },
      });
    });

    it('cannot nest a notebook inside itself', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['work', null]));
      prisma.notebook.findFirst.mockResolvedValue(notebook('work'));
      await expect(service.update(USER, 'work', { parentId: 'work' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('cannot move a notebook into one that is inside it, which would be a loop', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['a', null], ['b', 'a'], ['c', 'b']));
      prisma.notebook.findFirst.mockResolvedValue(notebook('a'));
      await expect(service.update(USER, 'a', { parentId: 'c' })).rejects.toThrow(
        'A notebook cannot be moved into a notebook that is inside it',
      );
      expect(prisma.notebook.update).not.toHaveBeenCalled();
    });

    it('cannot move a notebook to where what is inside it would end up too deep', async () => {
      // "a" takes up three levels. Inside "y", which is at level two, it would reach level five.
      prisma.notebook.findMany.mockResolvedValue(shape(['a', null], ['b', 'a'], ['c', 'b'], ['x', null], ['y', 'x']));
      prisma.notebook.findFirst.mockResolvedValue(notebook('a'));
      await expect(service.update(USER, 'a', { parentId: 'y' })).rejects.toThrow(
        'Notebooks can be nested 4 levels deep at most',
      );
      expect(prisma.notebook.update).not.toHaveBeenCalled();

      // Inside "x" it just fits.
      prisma.notebook.findFirst.mockReset().mockResolvedValueOnce(notebook('a')).mockResolvedValueOnce(null);
      prisma.notebook.findFirstOrThrow.mockResolvedValue(withCount(notebook('a', { parentId: 'x' })));
      await service.update(USER, 'a', { parentId: 'x' });
      expect(prisma.notebook.update).toHaveBeenCalledWith({ where: { id: 'a' }, data: { name: 'a', parentId: 'x' } });
    });

    it("404s for a notebook or a new parent that is not this user's", async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['work', null]));
      prisma.notebook.findFirst.mockResolvedValueOnce(null);
      await expect(service.update(USER, 'theirs', { name: 'X' })).rejects.toBeInstanceOf(NotFoundException);

      prisma.notebook.findFirst.mockResolvedValueOnce(notebook('work'));
      await expect(service.update(USER, 'work', { parentId: 'theirs' })).rejects.toThrow('Parent notebook not found');
    });
  });

  describe('remove', () => {
    it('moves the notes of the notebook and of everything inside it to the trash', async () => {
      prisma.notebook.findMany.mockResolvedValue(shape(['work', null], ['meetings', 'work'], ['weekly', 'meetings']));
      // The lock first, then the notebook with everything below it.
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'work' }, { id: 'meetings' }, { id: 'weekly' }]);
      prisma.note.updateMany.mockResolvedValue({ count: 4 });
      prisma.notebook.delete.mockResolvedValue(notebook('work'));

      await expect(service.remove(USER, 'work')).resolves.toEqual({ trashedNotes: 4 });
      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { userId: USER, notebookId: { in: ['work', 'meetings', 'weekly'] }, deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
      expect(prisma.notebook.delete).toHaveBeenCalledWith({ where: { id: 'work' } });
      expect(prisma.note.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.notebook.delete.mock.invocationCallOrder[0],
      );
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('404s for an unknown notebook and deletes nothing', async () => {
      prisma.notebook.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([]);
      await expect(service.remove(USER, 'nope')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.notebook.delete).not.toHaveBeenCalled();
    });
  });

  describe('idsWithChildren', () => {
    it('returns the notebook and everything below it from one query', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'work' }, { id: 'a' }, { id: 'b' }, { id: 'deep' }]);
      await expect(service.idsWithChildren(USER, 'work')).resolves.toEqual(['work', 'a', 'b', 'deep']);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const [sql, ...values] = prisma.$queryRaw.mock.calls[0] as [string[], ...unknown[]];
      expect(sql.join('?')).toContain('WITH RECURSIVE');
      // The notebook and the user are parameters, and the user is checked at every level.
      expect(values).toEqual(['work', USER, USER, 16]);
    });

    it('404s for a notebook of another user', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await expect(service.idsWithChildren(USER, 'theirs')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

describe('the shape of the notebook tree', () => {
  const parents = new Map<string, string | null>([
    ['a', null],
    ['b', 'a'],
    ['c', 'b'],
    ['side', 'a'],
    ['alone', null],
  ]);

  it('knows how deep a notebook sits', () => {
    expect(depthOf(parents, 'a')).toBe(1);
    expect(depthOf(parents, 'c')).toBe(3);
    expect(depthOf(parents, 'alone')).toBe(1);
  });

  it('knows how many levels a notebook takes up with what is inside it', () => {
    expect(heightOf(parents, 'a')).toBe(3);
    expect(heightOf(parents, 'b')).toBe(2);
    expect(heightOf(parents, 'side')).toBe(1);
  });

  it('knows whether a notebook is inside another', () => {
    expect(isInside(parents, 'c', 'a')).toBe(true);
    expect(isInside(parents, 'a', 'a')).toBe(true);
    expect(isInside(parents, 'a', 'c')).toBe(false);
    expect(isInside(parents, 'alone', 'a')).toBe(false);
  });

  it('comes to an end on data with a loop in it', () => {
    const loop = new Map<string, string | null>([
      ['x', 'y'],
      ['y', 'x'],
    ]);
    expect(depthOf(loop, 'x')).toBeGreaterThan(MAX_NOTEBOOK_DEPTH - 2);
    expect(heightOf(loop, 'x')).toBe(2);
    expect(isInside(loop, 'x', 'z')).toBe(false);
  });
});
