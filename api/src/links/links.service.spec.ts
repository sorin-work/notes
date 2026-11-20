import { NotFoundException } from '@nestjs/common';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { linkContext, LinksService, MAX_GRAPH_NODES } from './links.service';

const USER = 'user-1';

describe('LinksService', () => {
  let prisma: PrismaMock;
  let service: LinksService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new LinksService(asPrismaService(prisma));
  });

  describe('sync', () => {
    it('replaces the stored links with the ones in the content', async () => {
      await service.sync(asPrismaService(prisma), 'n1', 'Links to [[Alpha]] and [[beta|B]]');
      expect(prisma.noteLink.deleteMany).toHaveBeenCalledWith({ where: { sourceId: 'n1' } });
      expect(prisma.noteLink.createMany).toHaveBeenCalledWith({
        data: [
          { sourceId: 'n1', targetTitle: 'Alpha', targetKey: 'alpha' },
          { sourceId: 'n1', targetTitle: 'beta', targetKey: 'beta' },
        ],
      });
    });

    it('only deletes when there are no links left', async () => {
      await service.sync(asPrismaService(prisma), 'n1', 'No links here');
      expect(prisma.noteLink.deleteMany).toHaveBeenCalled();
      expect(prisma.noteLink.createMany).not.toHaveBeenCalled();
    });
  });

  describe('graph', () => {
    it('asks for nodes and edges in one query and maps the answer', async () => {
      const nodes = [
        { id: 'a', title: 'Atlas' },
        { id: 'b', title: 'Budget' },
      ];
      prisma.$queryRaw.mockResolvedValue([{ total: BigInt(412), nodes, edges: [{ source: 'a', target: 'b' }] }]);

      await expect(service.graph(USER)).resolves.toEqual({
        nodes,
        edges: [{ source: 'a', target: 'b' }],
        total: 412,
      });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('passes the filters and the limit as parameters, never as SQL text', async () => {
      prisma.$queryRaw.mockResolvedValue([{ total: BigInt(0), nodes: [], edges: [] }]);
      await service.graph(USER, { notebookIds: ['nb-1', 'nb-2'], tag: "x'); DROP TABLE notes; --" });

      const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [string[], ...unknown[]];
      const where = values.find((value) => (value as { sql?: string }).sql?.includes('n.notebook_id')) as {
        sql: string;
        values: unknown[];
      };
      expect(where.values).toEqual([USER, 'nb-1', 'nb-2', USER, "x'); DROP TABLE notes; --"]);
      expect(where.sql).toContain('n.notebook_id IN (?::uuid,?::uuid)');
      expect(values).toContain(MAX_GRAPH_NODES);
      expect(strings.join('?') + where.sql).not.toMatch(/drop|nb-1/i);
    });

    it('asks for the notes outside any notebook with "none"', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await expect(service.graph(USER, { notebookIds: 'none' })).resolves.toEqual({ nodes: [], edges: [], total: 0 });
      const where = (prisma.$queryRaw.mock.calls[0] as { sql?: string }[]).find((value) => value?.sql?.includes('n.'));
      expect(where?.sql).toContain('n.notebook_id IS NULL');
    });
  });

  describe('backlinks', () => {
    it('finds notes linking to the title, with the paragraph around the link', async () => {
      prisma.note.findFirst.mockResolvedValue({ title: 'Project Atlas' });
      const updatedAt = new Date();
      prisma.note.findMany.mockResolvedValue([
        { id: 'n2', title: 'Sync', updatedAt, content: 'Intro\n\nAs discussed in [[project atlas]] today.\n\nOther' },
      ]);

      const result = await service.backlinks(USER, 'n1');

      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER,
            deletedAt: null,
            id: { not: 'n1' },
            outgoingLinks: { some: { targetKey: 'project atlas' } },
          },
        }),
      );
      expect(result).toEqual([{ id: 'n2', title: 'Sync', updatedAt, context: 'As discussed in project atlas today.' }]);
    });

    it('404s for notes of other users', async () => {
      prisma.note.findFirst.mockResolvedValue(null);
      await expect(service.backlinks(USER, 'n1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('outgoing', () => {
    it('marks which links resolve to a note', async () => {
      prisma.note.findFirst.mockResolvedValue({
        outgoingLinks: [
          { targetTitle: 'Alpha', targetKey: 'alpha' },
          { targetTitle: 'Missing', targetKey: 'missing' },
        ],
      });
      prisma.$queryRaw.mockResolvedValue([{ id: 'a1', key: 'alpha' }]);
      await expect(service.outgoing(USER, 'n1')).resolves.toEqual([
        { title: 'Alpha', noteId: 'a1' },
        { title: 'Missing', noteId: null },
      ]);
    });

    it('does not query titles for a note without links', async () => {
      prisma.note.findFirst.mockResolvedValue({ outgoingLinks: [] });
      await expect(service.outgoing(USER, 'n1')).resolves.toEqual([]);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('titleTaken', () => {
    it('is true when a note outside the trash has the title, whatever its case', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'a1' }]);
      await expect(service.titleTaken(USER, ' Project  ATLAS')).resolves.toBe(true);
      // The title goes into the query as a value, in the form links are matched by.
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([USER, 'project atlas', null, null]);
    });

    it('is false when no note has it, asks the transaction it is given and can leave a note out', async () => {
      const tx = { $queryRaw: jest.fn().mockResolvedValue([]) };
      await expect(service.titleTaken(USER, 'Atlas', { db: tx as never, except: 'n1' })).resolves.toBe(false);
      expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual([USER, 'atlas', 'n1', 'n1']);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('resolve', () => {
    it('returns the matching note', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: 'a1', key: 'alpha' }]);
      prisma.note.findUniqueOrThrow.mockResolvedValue({ id: 'a1', title: 'Alpha' });
      await expect(service.resolve(USER, '  ALPHA ')).resolves.toEqual({ id: 'a1', title: 'Alpha' });
    });

    it('404s when no note has the title', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await expect(service.resolve(USER, 'Nothing')).rejects.toThrow('No note is called "Nothing"');
    });
  });
});

describe('linkContext', () => {
  it('returns an empty string when the link is not found', () => {
    expect(linkContext('no links', 'alpha')).toBe('');
  });

  it('shortens long paragraphs', () => {
    const paragraph = `${'word '.repeat(80)}[[Alpha]]`;
    expect(linkContext(paragraph, 'alpha').length).toBeLessThanOrEqual(201);
  });
});
