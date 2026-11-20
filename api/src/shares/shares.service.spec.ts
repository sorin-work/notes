import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../auth/password';
import type { AppConfig } from '../config/config';
import type { LinksService } from '../links/links.service';
import { asPrismaService, createPrismaMock, PrismaMock } from '../testing/prisma-mock';
import { accessIsValid } from './share-access';
import { SharePasswordAttempts, TooManyWrongPasswords } from './share-password-attempts';
import { newShareToken, SharesService } from './shares.service';

const USER = 'user-1';
const OWNER = 'owner-1';
const SECRET = 'a-secret-that-is-long-enough-0123456789';
const createdAt = new Date('2026-02-14T10:00:00Z');
const now = new Date('2026-03-01T12:00:00Z');

describe('SharesService', () => {
  let prisma: PrismaMock;
  let links: { resolveKeys: jest.Mock };
  let service: SharesService;
  let attempts: SharePasswordAttempts;

  beforeEach(() => {
    prisma = createPrismaMock();
    links = { resolveKeys: jest.fn().mockResolvedValue(new Map()) };
    // Three wrong passwords a minute for a link.
    attempts = new SharePasswordAttempts({ authThrottleLimit: 3 } as AppConfig);
    service = new SharesService(
      asPrismaService(prisma),
      links as unknown as LinksService,
      {
        jwtSecret: SECRET,
      } as AppConfig,
      attempts,
      {
        urls: (list: { id: string }[]) => Object.fromEntries(list.map((item) => [item.id, `/signed/${item.id}`])),
      } as never,
    );
  });

  const link = { id: 's1', noteId: 'n1', token: 'tok', viewCount: 4, createdAt, expiresAt: null, passwordHash: null };

  describe('for the owner', () => {
    it('returns null for a note that is not shared', async () => {
      prisma.note.findFirst.mockResolvedValue({ deletedAt: null });
      prisma.shareLink.findUnique.mockResolvedValue(null);
      await expect(service.get(USER, { noteId: 'n1' })).resolves.toBeNull();
    });

    it('creates a link or returns the existing one', async () => {
      prisma.note.findFirst.mockResolvedValue({ deletedAt: null });
      prisma.shareLink.upsert.mockResolvedValue(link);
      await expect(service.create(USER, { noteId: 'n1' })).resolves.toEqual({
        token: 'tok',
        viewCount: 4,
        createdAt,
        expiresAt: null,
        expired: false,
        hasPassword: false,
      });
      expect(prisma.shareLink.upsert).toHaveBeenCalledWith({
        where: { noteId: 'n1' },
        create: { noteId: 'n1', token: expect.any(String) },
        update: {},
      });
    });

    it("shares a notebook the same way, if it is the user's own", async () => {
      prisma.notebook.findFirst.mockResolvedValue({ id: 'nb1' });
      prisma.shareLink.upsert.mockResolvedValue({ ...link, noteId: null, notebookId: 'nb1' });
      await service.create(USER, { notebookId: 'nb1' }, {});
      expect(prisma.notebook.findFirst.mock.calls[0][0].where).toEqual({ id: 'nb1', userId: USER });
      expect(prisma.shareLink.upsert.mock.calls[0][0]).toMatchObject({
        where: { notebookId: 'nb1' },
        create: { notebookId: 'nb1' },
      });

      prisma.notebook.findFirst.mockResolvedValue(null);
      await expect(service.create(USER, { notebookId: 'someone-elses' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not share notes in the trash', async () => {
      prisma.note.findFirst.mockResolvedValue({ deletedAt: new Date() });
      await expect(service.create(USER, { noteId: 'n1' })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('revokes the link', async () => {
      prisma.note.findFirst.mockResolvedValue({ deletedAt: null });
      await service.revoke(USER, { noteId: 'n1' });
      expect(prisma.shareLink.deleteMany).toHaveBeenCalledWith({ where: { noteId: 'n1' } });
    });

    describe('options', () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      beforeEach(() => {
        prisma.note.findFirst.mockResolvedValue({ deletedAt: null });
        prisma.shareLink.findUnique.mockResolvedValue(link);
        prisma.shareLink.update.mockImplementation(({ data }) => Promise.resolve({ ...link, ...data }));
      });

      it('sets an expiry and a password, storing the password only as a hash', async () => {
        const view = await service.update(
          USER,
          { noteId: 'n1' },
          { expiresAt: tomorrow.toISOString(), password: 'open sesame' },
        );

        const { data } = prisma.shareLink.update.mock.calls[0][0];
        expect(data.expiresAt).toEqual(tomorrow);
        expect(data.passwordHash).not.toContain('open sesame');
        expect(await verifyPassword('open sesame', data.passwordHash)).toBe(true);
        expect(view).toMatchObject({ expiresAt: tomorrow, expired: false, hasPassword: true });
        expect(view).not.toHaveProperty('passwordHash');
      });

      it('takes both away with null, and leaves alone what is not mentioned', async () => {
        await service.update(USER, { noteId: 'n1' }, { expiresAt: null, password: null });
        expect(prisma.shareLink.update.mock.calls[0][0].data).toEqual({ expiresAt: null, passwordHash: null });

        await service.update(USER, { noteId: 'n1' }, {});
        expect(prisma.shareLink.update.mock.calls[1][0].data).toEqual({});
      });

      it('refuses a date that cannot be read, should one get past the DTO', async () => {
        await expect(service.update(USER, { noteId: 'n1' }, { expiresAt: '2027-W01' })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.shareLink.update).not.toHaveBeenCalled();
      });

      it('refuses an expiry that has already passed', async () => {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await expect(service.update(USER, { noteId: 'n1' }, { expiresAt: yesterday })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(prisma.shareLink.update).not.toHaveBeenCalled();
      });

      it('404s for a note that is not shared', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(null);
        await expect(service.update(USER, { noteId: 'n1' }, { password: null })).rejects.toBeInstanceOf(
          NotFoundException,
        );
      });

      it('shows the owner that a link has run out', async () => {
        prisma.shareLink.findUnique.mockResolvedValue({ ...link, expiresAt: new Date(Date.now() - 1000) });
        await expect(service.get(USER, { noteId: 'n1' })).resolves.toMatchObject({ expired: true });
      });
    });
  });

  describe('for readers', () => {
    const noteLink = {
      ...link,
      notebookId: null as string | null,
      expiresAt: null as Date | null,
      passwordHash: null as string | null,
      note: { userId: OWNER, deletedAt: null as Date | null } as { userId: string; deletedAt: Date | null } | null,
      notebook: null as { id: string; userId: string; children: { id: string }[] } | null,
    };
    const notebookLink = {
      ...noteLink,
      noteId: null,
      notebookId: 'nb1',
      note: null,
      notebook: { id: 'nb1', userId: OWNER, children: [{ id: 'nb2' }] },
    };
    const recipe = {
      id: 'n1',
      title: 'Recipe',
      content: 'Bread',
      updatedAt: createdAt,
      tags: [{ tag: { name: 'baking' } }],
      attachments: [] as { id: string; userId: string }[],
    };

    beforeEach(() => {
      prisma.shareLink.findUnique.mockResolvedValue(noteLink);
      prisma.shareLink.findMany.mockResolvedValue([]);
      prisma.note.findFirst.mockResolvedValue(recipe);
      prisma.note.findMany.mockResolvedValue([]);
    });

    it("signs the addresses of the note's own attachments only", async () => {
      prisma.note.findFirst.mockResolvedValue({ ...recipe, attachments: [{ id: 'a1', userId: OWNER }] });
      await expect(service.view('tok')).resolves.toMatchObject({ attachments: { a1: '/signed/a1' } });
      // They are asked for with the note itself, so only that note's files can be in the answer.
      expect(prisma.note.findFirst.mock.calls[0][0].select.attachments).toEqual({ select: { id: true, userId: true } });
    });

    it('returns the note and counts the view', async () => {
      await expect(service.view('tok')).resolves.toEqual({
        kind: 'note',
        title: 'Recipe',
        content: 'Bread',
        tags: ['baking'],
        updatedAt: createdAt,
        links: {},
        attachments: {},
      });
      expect(prisma.note.findFirst.mock.calls[0][0].where).toEqual({ id: 'n1', userId: OWNER, deletedAt: null });
      expect(prisma.shareLink.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { viewCount: { increment: 1 } },
      });
    });

    it('404s for unknown tokens and once the note is in the trash', async () => {
      prisma.shareLink.findUnique.mockResolvedValue(null);
      await expect(service.view('nope')).rejects.toBeInstanceOf(NotFoundException);

      prisma.shareLink.findUnique.mockResolvedValue({ ...noteLink, note: { userId: OWNER, deletedAt: new Date() } });
      await expect(service.view('tok')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shareLink.update).not.toHaveBeenCalled();
    });

    it('does not count the owner looking at their own note', async () => {
      await service.view('tok', { userId: OWNER });
      expect(prisma.shareLink.update).not.toHaveBeenCalled();
      await service.view('tok', { userId: 'someone-else' });
      expect(prisma.shareLink.update).toHaveBeenCalledTimes(1);
    });

    it('stops working the moment it runs out', async () => {
      prisma.shareLink.findUnique.mockResolvedValue({ ...noteLink, expiresAt: new Date(now.getTime() + 1000) });
      await expect(service.view('tok', {}, now)).resolves.toMatchObject({ title: 'Recipe' });

      prisma.shareLink.findUnique.mockResolvedValue({ ...noteLink, expiresAt: now });
      await expect(service.view('tok', {}, now)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.shareLink.update).toHaveBeenCalledTimes(1);
    });

    describe('behind a password', () => {
      let protectedLink: typeof noteLink;

      beforeAll(async () => {
        protectedLink = { ...noteLink, passwordHash: await hashPassword('open sesame') };
      });
      beforeEach(() => prisma.shareLink.findUnique.mockResolvedValue(protectedLink));

      const refusal = (error: unknown) => (error as ForbiddenException).getResponse();

      it('asks for the password, in a way the page can tell from "gone"', async () => {
        const refused = await service.view('tok').catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(ForbiddenException);
        expect(refusal(refused)).toMatchObject({ statusCode: 403, passwordRequired: true });
        expect(prisma.note.findFirst).not.toHaveBeenCalled();
        expect(prisma.shareLink.update).not.toHaveBeenCalled();
      });

      it('refuses a wrong password the same way and counts no view', async () => {
        const refused = await service.view('tok', { password: 'open says me' }).catch((error: unknown) => error);
        expect(refusal(refused)).toMatchObject({ statusCode: 403, passwordRequired: true });
        expect(prisma.shareLink.update).not.toHaveBeenCalled();
      });

      it('shows the note for the right password, with proof to read on without it', async () => {
        const opened = await service.view('tok', { password: 'open sesame' }, now);
        expect(opened).toMatchObject({ kind: 'note', title: 'Recipe' });
        expect(accessIsValid(SECRET, opened.access, 's1', protectedLink.passwordHash ?? '', now)).toBe(true);
        expect(prisma.shareLink.update).toHaveBeenCalledTimes(1);

        const again = await service.view('tok', { access: opened.access }, now);
        expect(again).toMatchObject({ title: 'Recipe' });
        expect(again).not.toHaveProperty('access');
      });

      it('takes no proof made for another link or for a password that has changed since', async () => {
        const { access } = await service.view('tok', { password: 'open sesame' }, now);

        prisma.shareLink.findUnique.mockResolvedValue({ ...protectedLink, id: 's2' });
        await expect(service.view('other', { access }, now)).rejects.toBeInstanceOf(ForbiddenException);

        prisma.shareLink.findUnique.mockResolvedValue({
          ...protectedLink,
          passwordHash: await hashPassword('open sesame'),
        });
        await expect(service.view('tok', { access }, now)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.view('tok', { access: 'made-up' }, now)).rejects.toBeInstanceOf(ForbiddenException);
      });

      /** How a password was refused. Fails the test when it was taken. */
      const guess = async (viewer: { userId?: string; password: string }): Promise<HttpException> => {
        try {
          await service.view('tok', viewer);
        } catch (error) {
          return error as HttpException;
        }
        throw new Error(`"${viewer.password}" opened the note`);
      };

      it('takes three wrong passwords a minute and then refuses every password, the right one too', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        for (const password of ['guess-1', 'guess-2', 'guess-3']) {
          expect((await guess({ password })).getStatus()).toBe(403);
        }
        const fourth = await guess({ password: 'guess-4' });
        expect(fourth).toBeInstanceOf(TooManyWrongPasswords);
        expect(fourth.getStatus()).toBe(429);
        expect((fourth as TooManyWrongPasswords).retryAfterSeconds).toBeGreaterThan(0);
        expect((await guess({ password: 'open sesame' })).getStatus()).toBe(429);
        expect(prisma.shareLink.update).not.toHaveBeenCalled();
      });

      it('refuses without comparing the password once the allowance is gone', async () => {
        // A hash that makes the comparison throw, so reaching it would show.
        prisma.shareLink.findUnique.mockResolvedValue({ ...protectedLink, passwordHash: 42 });
        for (let i = 0; i < 3; i++) attempts.take('s1');
        expect((await guess({ password: 'open sesame' })).getStatus()).toBe(429);
      });

      it('does not count right passwords, so readers do not close the link to each other', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        for (let i = 0; i < 5; i++) {
          await expect(service.view('tok', { password: 'open sesame' })).resolves.toMatchObject({ title: 'Recipe' });
        }
        expect((await guess({ password: 'guess-1' })).getStatus()).toBe(403);
        expect((await guess({ password: 'guess-2' })).getStatus()).toBe(403);
        await expect(service.view('tok', { password: 'open sesame' })).resolves.toMatchObject({ title: 'Recipe' });
        expect((await guess({ password: 'guess-3' })).getStatus()).toBe(403);
        expect((await guess({ password: 'open sesame' })).getStatus()).toBe(429);
      });

      it('never holds the owner back, and does not count the owner against the link', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        // The owner mistypes more often than the link allows: still 403, and nothing is used up.
        for (let i = 0; i < 4; i++) {
          expect((await guess({ userId: 'owner-1', password: 'mistyped' })).getStatus()).toBe(403);
        }
        for (const password of ['guess-1', 'guess-2', 'guess-3']) {
          expect((await guess({ password })).getStatus()).toBe(403);
        }
        expect((await guess({ userId: 'someone-else', password: 'open sesame' })).getStatus()).toBe(429);
        // Closed to everyone else, open to the owner.
        await expect(service.view('tok', { userId: 'owner-1', password: 'open sesame' })).resolves.toMatchObject({
          title: 'Recipe',
        });
      });

      it('counts each link on its own', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(protectedLink);
        for (const password of ['guess-1', 'guess-2', 'guess-3']) await guess({ password });
        prisma.shareLink.findUnique.mockResolvedValue({ ...protectedLink, id: 's2' });
        await expect(service.view('tok-2', { password: 'open sesame' })).resolves.toMatchObject({ title: 'Recipe' });
      });

      it('looks like any dead link once it has run out, password or not', async () => {
        prisma.shareLink.findUnique.mockResolvedValue({ ...protectedLink, expiresAt: now });
        await expect(service.view('tok', {}, now)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.view('tok', { password: 'open sesame' }, now)).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.view('tok', { password: 'wrong' }, now)).rejects.toBeInstanceOf(NotFoundException);
      });
    });

    describe('links to other notes', () => {
      const linking = {
        ...recipe,
        content: 'See [[Starter]], [[Flour|the flour note]], [[Secret plan|a plan]] and [[Nothing here]].',
      };

      beforeEach(() => {
        prisma.note.findFirst.mockResolvedValue(linking);
      });

      it('follows a link only to a note whose own link is open to anyone, and hides every other title behind its text', async () => {
        prisma.shareLink.findMany.mockResolvedValue([
          { noteId: 'n-starter', token: 'tok-starter' },
          { noteId: 'n-other', token: 'tok-other' },
        ]);
        links.resolveKeys.mockResolvedValue(new Map([['starter', 'n-starter']]));

        const shared = await service.view('tok', {}, now);

        // Only links without a password that have not run out, of the owner's notes outside the trash.
        expect(prisma.shareLink.findMany.mock.calls[0][0].where).toEqual({
          passwordHash: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          note: { userId: OWNER, deletedAt: null },
        });
        // Titles are looked up among those notes only, not among all of the owner's.
        expect(links.resolveKeys).toHaveBeenCalledTimes(1);
        expect(links.resolveKeys).toHaveBeenCalledWith(OWNER, ['starter', 'flour', 'secret plan', 'nothing here'], {
          noteIds: ['n-starter', 'n-other'],
        });
        expect(shared).toMatchObject({
          content: 'See [[Starter]], the flour note, a plan and Nothing here.',
          links: { starter: '/s/tok-starter' },
        });
        expect(JSON.stringify(shared)).not.toContain('Secret plan');
      });

      it('asks nothing more when the owner has no open link at all', async () => {
        prisma.shareLink.findMany.mockResolvedValue([]);
        const shared = await service.view('tok', {}, now);
        expect(links.resolveKeys).not.toHaveBeenCalled();
        expect(shared).toMatchObject({ links: {}, content: 'See Starter, the flour note, a plan and Nothing here.' });
      });

      it('looks inside the shared notebook first, and outside it only for what is left', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(notebookLink);
        links.resolveKeys
          .mockResolvedValueOnce(
            new Map([
              ['starter', 'n-starter'],
              ['flour', 'n-flour'],
            ]),
          )
          .mockResolvedValueOnce(new Map([['nothing here', 'n-open']]));
        prisma.shareLink.findMany.mockResolvedValue([{ noteId: 'n-open', token: 'tok-open' }]);

        const shared = await service.viewNote('tok', 'n1', {}, now);

        expect(links.resolveKeys.mock.calls).toEqual([
          [OWNER, ['starter', 'flour', 'secret plan', 'nothing here'], { notebookIds: ['nb1', 'nb2'] }],
          [OWNER, ['secret plan', 'nothing here'], { noteIds: ['n-open'] }],
        ]);
        expect(shared.links).toEqual({
          starter: '/s/tok/n-starter',
          flour: '/s/tok/n-flour',
          'nothing here': '/s/tok-open',
        });
        expect(shared.content).toBe('See [[Starter]], [[Flour|the flour note]], a plan and [[Nothing here]].');
      });
    });

    describe('a shared notebook', () => {
      beforeEach(() => prisma.shareLink.findUnique.mockResolvedValue(notebookLink));

      it('lists the notes of the notebook and of the notebooks inside it, and nothing else', async () => {
        prisma.notebook.findUniqueOrThrow.mockResolvedValue({ name: 'Recipes' });
        prisma.note.findMany.mockResolvedValue([
          { id: 'b', title: 'Rye', updatedAt: createdAt, notebookId: 'nb2', notebook: { name: 'Bread' } },
          { id: 'a', title: 'Soup', updatedAt: createdAt, notebookId: 'nb1', notebook: { name: 'Recipes' } },
          { id: 'c', title: 'Baguette', updatedAt: createdAt, notebookId: 'nb2', notebook: { name: 'Bread' } },
        ]);

        const index = await service.view('tok');

        expect(index).toEqual({
          kind: 'notebook',
          name: 'Recipes',
          notes: [
            { id: 'a', title: 'Soup', updatedAt: createdAt, notebook: null },
            { id: 'c', title: 'Baguette', updatedAt: createdAt, notebook: 'Bread' },
            { id: 'b', title: 'Rye', updatedAt: createdAt, notebook: 'Bread' },
          ],
        });
        expect(prisma.note.findMany.mock.calls[0][0].where).toEqual({
          userId: OWNER,
          deletedAt: null,
          isTemplate: false,
          notebookId: { in: ['nb1', 'nb2'] },
        });
      });

      it('serves a note only while it is in the notebook, asked with every request', async () => {
        await expect(service.viewNote('tok', 'n1')).resolves.toMatchObject({ kind: 'note', title: 'Recipe' });
        expect(prisma.note.findFirst.mock.calls[0][0].where).toEqual({
          id: 'n1',
          notebookId: { in: ['nb1', 'nb2'] },
          userId: OWNER,
          deletedAt: null,
          isTemplate: false,
        });

        // Moved out or put in the trash: the same query finds nothing.
        prisma.note.findFirst.mockResolvedValue(null);
        await expect(service.viewNote('tok', 'n1')).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.shareLink.update).toHaveBeenCalledTimes(1);
      });

      it('has no notes to hand out under a link to a single note', async () => {
        prisma.shareLink.findUnique.mockResolvedValue(noteLink);
        await expect(service.viewNote('tok', 'n2')).rejects.toBeInstanceOf(NotFoundException);
        expect(prisma.note.findFirst).not.toHaveBeenCalled();
      });
    });
  });
});

describe('newShareToken', () => {
  it('makes URL-safe tokens that are hard to guess', () => {
    const tokens = new Set(Array.from({ length: 50 }, newShareToken));
    expect(tokens.size).toBe(50);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});
