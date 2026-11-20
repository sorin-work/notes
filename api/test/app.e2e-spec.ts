/**
 * End-to-end tests against a real Postgres database. Run with
 * `npm run test:e2e` and DATABASE_URL pointing at a database (or a schema,
 * e.g. ?schema=e2e) that the tests may write to. Every test signs up its own
 * user, so the tests do not interfere with each other or with existing data.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import JSZip from 'jszip';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { LinksService } from '../src/links/links.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

process.env.JWT_SECRET ??= 'e2e-secret-that-is-long-enough-0123456789';
process.env.AUTH_THROTTLE_LIMIT ??= '1000';
process.env.SEED_DEMO = 'false';

let app: INestApplication<App>;
let counter = 0;

async function signUp(): Promise<{ token: string; auth: { Authorization: string } }> {
  const email = `e2e-${Date.now()}-${++counter}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, name: 'E2E', password: 'password123' })
    .expect(201);
  return { token: response.body.token, auth: { Authorization: `Bearer ${response.body.token}` } };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('auth', () => {
  it('signs up, logs in and returns the current user', async () => {
    const email = `login-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: email.toUpperCase(), name: 'Ada', password: 'password123' })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200);
    expect(me.body).toMatchObject({ email, name: 'Ada' });
    expect(me.body.passwordHash).toBeUndefined();
  });

  it('validates sign-up input', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'not-an-email', name: ' ', password: 'short' })
      .expect(400);
    expect(response.body.message).toEqual(
      expect.arrayContaining(['email must be a valid email address', 'password must be at least 8 characters long']),
    );
  });

  it('rejects unknown fields', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ email: 'x@example.com', name: 'X', password: 'password123', admin: true })
      .expect(400);
  });

  it('needs a token for everything else', async () => {
    await request(app.getHttpServer()).get('/api/notes').expect(401);
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
});

describe('notes', () => {
  it('creates, edits, lists and trashes notes', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();

    const notebook = await request(server).post('/api/notebooks').set(auth).send({ name: 'Work' }).expect(201);
    const created = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Plan', content: 'First draft', notebookId: notebook.body.id, tags: ['Q1', 'work'] })
      .expect(201);
    expect(created.body).toMatchObject({ title: 'Plan', tags: ['q1', 'work'], notebook: { name: 'Work' } });

    const updated = await request(server)
      .patch(`/api/notes/${created.body.id}`)
      .set(auth)
      .send({ content: 'Second draft', pinned: true })
      .expect(200);
    expect(updated.body).toMatchObject({ content: 'Second draft', pinned: true });

    const list = await request(server).get(`/api/notes?notebookId=${notebook.body.id}`).set(auth).expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ title: 'Plan', excerpt: 'Second draft' });

    const versions = await request(server).get(`/api/notes/${created.body.id}/versions`).set(auth).expect(200);
    expect(versions.body).toHaveLength(1);

    await request(server).delete(`/api/notes/${created.body.id}`).set(auth).expect(204);
    const after = await request(server).get('/api/notes').set(auth).expect(200);
    expect(after.body.total).toBe(0);
    const trash = await request(server).get('/api/trash').set(auth).expect(200);
    expect(trash.body.map((note: { id: string }) => note.id)).toEqual([created.body.id]);

    await request(server).post(`/api/trash/${created.body.id}/restore`).set(auth).expect(204);
    await request(server).get(`/api/notes/${created.body.id}`).set(auth).expect(200);
  });

  it('keeps users apart', async () => {
    const alice = await signUp();
    const bob = await signUp();
    const note = await request(app.getHttpServer()).post('/api/notes').set(alice.auth).send({ title: 'Mine' });
    await request(app.getHttpServer()).get(`/api/notes/${note.body.id}`).set(bob.auth).expect(404);
    await request(app.getHttpServer())
      .patch(`/api/notes/${note.body.id}`)
      .set(bob.auth)
      .send({ title: 'x' })
      .expect(404);
  });

  it('validates ids and bodies', async () => {
    const { auth } = await signUp();
    await request(app.getHttpServer()).get('/api/notes/not-a-uuid').set(auth).expect(400);
    await request(app.getHttpServer()).post('/api/notes').set(auth).send({ tags: 'not-a-list' }).expect(400);
  });
});

describe('links and search', () => {
  it('resolves [[links]], lists backlinks and searches by prefix', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();

    const target = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Project Atlas', content: 'Reporting dashboard' })
      .expect(201);
    const source = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Weekly sync', content: 'Talked about [[project atlas]] and [[Missing note]].' })
      .expect(201);

    const links = await request(server).get(`/api/notes/${source.body.id}/links`).set(auth).expect(200);
    expect(links.body).toEqual([
      { title: 'project atlas', noteId: target.body.id },
      { title: 'Missing note', noteId: null },
    ]);

    const backlinks = await request(server).get(`/api/notes/${target.body.id}/backlinks`).set(auth).expect(200);
    expect(backlinks.body).toEqual([expect.objectContaining({ id: source.body.id, title: 'Weekly sync' })]);

    const resolved = await request(server).get('/api/notes/resolve?title=PROJECT%20ATLAS').set(auth).expect(200);
    expect(resolved.body.id).toBe(target.body.id);

    const search = await request(server).get('/api/search?q=dashb').set(auth).expect(200);
    expect(search.body.items.map((hit: { id: string }) => hit.id)).toEqual([target.body.id]);
    expect(search.body.items[0].snippet).toContain('\u0002dashboard\u0003');

    await request(server).get('/api/search?q=%22%26%7C!').set(auth).expect(200);
  });

  it('searches inside a notebook or a tag, matches quoted phrases and pages', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const post = async (path: string, body: object, headers = auth) =>
      (await request(server).post(path).set(headers).send(body).expect(201)).body.id as string;
    const search = async (query: Record<string, string | number>) => {
      const response = await request(server).get('/api/search').query(query).set(auth).expect(200);
      return { ids: response.body.items.map((hit: { id: string }) => hit.id) as string[], total: response.body.total };
    };

    const work = await post('/api/notebooks', { name: 'Work' });
    const meetings = await post('/api/notebooks', { name: 'Meetings', parentId: work });
    const inWork = await post('/api/notes', { title: 'Plan', content: 'The weekly sync moved.', notebookId: work });
    const inMeetings = await post('/api/notes', {
      title: 'Minutes',
      content: 'Sync notes, sent weekly.',
      notebookId: meetings,
      tags: ['Team Sync'],
    });
    const unfiled = await post('/api/notes', { title: 'Loose', content: 'A weekly team sync.', tags: ['team-sync'] });

    expect((await search({ q: 'weekly sync' })).ids.sort()).toEqual([inWork, inMeetings, unfiled].sort());
    // A top-level notebook covers the notebooks inside it.
    expect((await search({ q: 'weekly sync', notebookId: work })).ids.sort()).toEqual([inWork, inMeetings].sort());
    expect((await search({ q: 'weekly sync', notebookId: meetings })).ids).toEqual([inMeetings]);
    expect((await search({ q: 'weekly sync', notebookId: 'none' })).ids).toEqual([unfiled]);
    expect((await search({ q: 'weekly sync', tag: '#Team Sync' })).ids.sort()).toEqual([inMeetings, unfiled].sort());
    expect((await search({ q: 'weekly sync', notebookId: work, tag: 'team-sync' })).ids).toEqual([inMeetings]);

    // In quotes the words have to follow each other in that order, and are not prefixes.
    expect((await search({ q: '"weekly sync"' })).ids).toEqual([inWork]);
    expect((await search({ q: '"weekly sync" plan' })).ids).toEqual([inWork]);
    expect((await search({ q: 'wee' })).total).toBe(3);
    expect((await search({ q: '"wee"' })).total).toBe(0);
    // A phrase that is still being typed searches as ordinary words.
    expect((await search({ q: '"weekly sy' })).total).toBe(3);
    // A phrase is split the way the note was, so dots inside words and numbers survive.
    const dotted = await post('/api/notes', { title: 'Setup', content: 'Use node.js today with a 3.5 mm jack.' });
    expect((await search({ q: '"node.js today"' })).ids).toEqual([dotted]);
    expect((await search({ q: '"3.5 mm" setup' })).ids).toEqual([dotted]);
    expect((await search({ q: '"node today"' })).total).toBe(0);

    const first = await search({ q: 'weekly sync', pageSize: 2 });
    const second = await search({ q: 'weekly sync', pageSize: 2, page: 2 });
    expect(first.total).toBe(3);
    expect([...first.ids, ...second.ids].sort()).toEqual([inWork, inMeetings, unfiled].sort());

    // Values that look like SQL are only ever compared, and another account's notebook is not found.
    expect((await search({ q: "sync' OR '1'='1", tag: "x' OR '1'='1" })).total).toBe(0);
    const foreign = await post('/api/notebooks', { name: 'Theirs' }, other.auth);
    await request(server).get('/api/search').query({ q: 'sync', notebookId: foreign }).set(auth).expect(404);
    await request(server).get('/api/search').query({ q: 'sync', notebookId: 'inbox' }).set(auth).expect(400);
  });

  it('answers 400, not 500, to filters and pages the database cannot take', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    await request(server).post('/api/notes').set(auth).send({ title: 'Sync', content: 'A sync.' }).expect(201);

    for (const path of ['/api/search?q=sync', '/api/notes?sort=title']) {
      await request(server).get(`${path}&notebookId=NONE`).set(auth).expect(400);
      await request(server).get(`${path}&tag=%00`).set(auth).expect(400);
      await request(server).get(`${path}&page=9223372036854775807`).set(auth).expect(400);
      await request(server).get(`${path}&notebookId=none&tag=sync&page=100000`).set(auth).expect(200);
    }
    // A null character inside a phrase is dropped instead of reaching the database.
    const phrase = await request(server).get('/api/search?q=%22a%00sync%22').set(auth).expect(200);
    expect(phrase.body.total).toBe(1);
  });

  it('pages through equally ranked results without repeats or gaps', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const created = await request(server).post('/api/notes').set(auth).send({ title: 'Twin', content: 'Same text.' });
      ids.push(created.body.id);
    }
    // Same text gives the same rank. With the same time as well, only the id is left to order by.
    const sameTime = new Date('2026-01-01T00:00:00Z');
    await app.get(PrismaService).note.updateMany({ where: { id: { in: ids } }, data: { updatedAt: sameTime } });

    const paged: string[] = [];
    for (const page of [1, 2, 3]) {
      const response = await request(server).get('/api/search').query({ q: 'twin', pageSize: 2, page }).set(auth);
      paged.push(...response.body.items.map((hit: { id: string }) => hit.id));
    }
    expect(paged).toEqual([...ids].sort());
  });
});

describe('renaming a note', () => {
  type Auth = { Authorization: string };

  async function createNote(auth: Auth, title: string, content = ''): Promise<{ id: string; updatedAt: string }> {
    const response = await request(app.getHttpServer()).post('/api/notes').set(auth).send({ title, content });
    expect(response.status).toBe(201);
    return response.body;
  }

  const getNote = async (auth: Auth, id: string) =>
    (await request(app.getHttpServer()).get(`/api/notes/${id}`).set(auth).expect(200)).body;

  const orphaned = async (auth: Auth, id: string, from: string) =>
    (await request(app.getHttpServer()).get(`/api/notes/${id}/rename-links`).query({ from }).set(auth).expect(200))
      .body;

  const renameLinks = (auth: Auth, id: string, body: object) =>
    request(app.getHttpServer()).post(`/api/notes/${id}/rename-links`).set(auth).send(body);

  it('points the links of the user’s notes at the new title, and nothing else', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();

    const target = await createNote(auth, 'Atlas', 'Reporting dashboard');
    const syncText = 'Talked about [[atlas]] and [[Atlas#Goals|the goals]].\r\n\r\n`[[Atlas]]` stays as it is.';
    const sync = await createNote(auth, 'Weekly sync', syncText);
    const ideas = await createNote(auth, 'Ideas', 'See [[Atlas]] and [[Other]].');
    const plain = await createNote(auth, 'Plain', 'Atlas without a link');
    const trashed = await createNote(auth, 'Thrown away', 'Was about [[Atlas]].');
    await request(server).delete(`/api/notes/${trashed.id}`).set(auth).expect(204);
    const theirs = await createNote(other.auth, 'Not mine', 'Another [[Atlas]] altogether.');

    // The title autosaves while it is typed, so the rename arrives in steps.
    await request(server).patch(`/api/notes/${target.id}`).set(auth).send({ title: 'Project' }).expect(200);
    await request(server).patch(`/api/notes/${target.id}`).set(auth).send({ title: 'Project Atlas' }).expect(200);

    // The rename itself rewrote nothing: the links dangle.
    expect((await getNote(auth, ideas.id)).content).toBe('See [[Atlas]] and [[Other]].');
    const dangling = await request(server).get(`/api/notes/${target.id}/backlinks`).set(auth).expect(200);
    expect(dangling.body).toEqual([]);
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 2 });
    expect(await orphaned(auth, target.id, 'Project')).toEqual({ count: 0 });

    const renamed = await renameLinks(auth, target.id, { from: ' atlas ' }).expect(200);
    expect(renamed.body).toEqual({ updated: 2, title: 'Project Atlas' });

    const syncAfter = await getNote(auth, sync.id);
    expect(syncAfter.content).toBe(
      'Talked about [[Project Atlas]] and [[Project Atlas#Goals|the goals]].\r\n\r\n`[[Atlas]]` stays as it is.',
    );
    // Not an edit by the user: the note keeps its place in "last edited".
    expect(syncAfter.updatedAt).toBe(sync.updatedAt);
    const ideasAfter = await getNote(auth, ideas.id);
    expect(ideasAfter.content).toBe('See [[Project Atlas]] and [[Other]].');
    expect(ideasAfter.updatedAt).toBe(ideas.updatedAt);

    // The old text is in the history, so the rewrite can be undone there.
    const versions = await request(server).get(`/api/notes/${sync.id}/versions`).set(auth).expect(200);
    expect(versions.body).toHaveLength(1);
    const version = await request(server)
      .get(`/api/notes/${sync.id}/versions/${versions.body[0].id}`)
      .set(auth)
      .expect(200);
    expect(version.body.content).toBe(syncText);

    // The links resolve again, and search finds the new text.
    const backlinks = await request(server).get(`/api/notes/${target.id}/backlinks`).set(auth).expect(200);
    expect(backlinks.body.map((link: { id: string }) => link.id).sort()).toEqual([sync.id, ideas.id].sort());
    const search = await request(server).get('/api/search?q=project').set(auth).expect(200);
    expect(search.body.items.map((hit: { id: string }) => hit.id)).toEqual(
      expect.arrayContaining([target.id, sync.id, ideas.id]),
    );
    const links = await request(server).get(`/api/notes/${ideas.id}/links`).set(auth).expect(200);
    expect(links.body).toEqual([
      { title: 'Project Atlas', noteId: target.id },
      { title: 'Other', noteId: null },
    ]);

    // Left alone: plain text, the trash, and other people's notes.
    expect((await getNote(auth, plain.id)).content).toBe('Atlas without a link');
    expect((await getNote(auth, trashed.id)).content).toBe('Was about [[Atlas]].');
    expect((await getNote(other.auth, theirs.id)).content).toBe('Another [[Atlas]] altogether.');
    await renameLinks(other.auth, target.id, { from: 'Atlas' }).expect(404);
    await request(server).get(`/api/notes/${target.id}/rename-links?from=Atlas`).set(other.auth).expect(404);

    // Nothing is left to do a second time.
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 0 });
    expect((await renameLinks(auth, target.id, { from: 'Atlas' }).expect(200)).body.updated).toBe(0);
  });

  it('rewrites nothing while the links still lead somewhere or the new title cannot be linked', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const target = await createNote(auth, 'Atlas');
    const source = await createNote(auth, 'Source', 'About [[Atlas]].');

    // Only the case changed: the links still find the note.
    await request(server).patch(`/api/notes/${target.id}`).set(auth).send({ title: 'ATLAS' }).expect(200);
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 0 });

    // Another note has taken the old title.
    await request(server).patch(`/api/notes/${target.id}`).set(auth).send({ title: 'Project Atlas' }).expect(200);
    const successor = await createNote(auth, 'atlas');
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 0 });
    expect((await renameLinks(auth, target.id, { from: 'Atlas' }).expect(200)).body.updated).toBe(0);
    expect((await getNote(auth, source.id)).content).toBe('About [[Atlas]].');

    // A note in the trash does not hold a title.
    await request(server).delete(`/api/notes/${successor.id}`).set(auth).expect(204);
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 1 });

    // [[Atlas | v2]] would be read as a link to "Atlas" with other text.
    await request(server).patch(`/api/notes/${target.id}`).set(auth).send({ title: 'Atlas | v2' }).expect(200);
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 0 });
    expect((await renameLinks(auth, target.id, { from: 'Atlas' }).expect(200)).body.updated).toBe(0);
    expect((await getNote(auth, source.id)).content).toBe('About [[Atlas]].');

    await renameLinks(auth, target.id, {}).expect(400);
    await renameLinks(auth, target.id, { from: '   ' }).expect(400);
    await renameLinks(auth, target.id, { from: 'Atlas', to: 'Elsewhere' }).expect(400);
    await renameLinks(auth, 'not-a-uuid', { from: 'Atlas' }).expect(400);
    await request(server).delete(`/api/notes/${target.id}`).set(auth).expect(204);
    await renameLinks(auth, target.id, { from: 'Atlas' }).expect(409);
  });

  it('rewrites all the notes or none', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const target = await createNote(auth, 'Atlas');
    const first = await createNote(auth, 'First', 'One [[Atlas]].');
    const second = await createNote(auth, 'Second', 'Two [[Atlas]].');
    await request(server).patch(`/api/notes/${target.id}`).set(auth).send({ title: 'Project Atlas' }).expect(200);

    // The second note fails after the first one was already written inside the transaction.
    const links = app.get(LinksService);
    const sync = links.sync.bind(links);
    let calls = 0;
    const failing = jest.spyOn(links, 'sync').mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error('Simulated failure halfway through the rewrite');
      return sync(...args);
    });
    try {
      await renameLinks(auth, target.id, { from: 'Atlas' }).expect(500);
    } finally {
      failing.mockRestore();
    }
    expect(calls).toBe(2);

    for (const note of [first, second]) {
      expect((await getNote(auth, note.id)).content).toMatch(/\[\[Atlas\]\]/);
      const versions = await request(server).get(`/api/notes/${note.id}/versions`).set(auth).expect(200);
      expect(versions.body).toEqual([]);
      const outgoing = await request(server).get(`/api/notes/${note.id}/links`).set(auth).expect(200);
      expect(outgoing.body).toEqual([{ title: 'Atlas', noteId: null }]);
    }

    expect((await renameLinks(auth, target.id, { from: 'Atlas' }).expect(200)).body.updated).toBe(2);
    expect((await getNote(auth, first.id)).content).toBe('One [[Project Atlas]].');
    expect((await getNote(auth, second.id)).content).toBe('Two [[Project Atlas]].');
  });
});

describe('sharing', () => {
  it('serves a read-only copy until the link is revoked', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const note = await request(server).post('/api/notes').set(auth).send({ title: 'Recipe', content: 'Bread' });

    const share = await request(server).post(`/api/notes/${note.body.id}/share`).set(auth).expect(200);
    const again = await request(server).post(`/api/notes/${note.body.id}/share`).set(auth).expect(200);
    expect(again.body.token).toBe(share.body.token);

    const shared = await request(server).get(`/api/public/notes/${share.body.token}`).expect(200);
    expect(shared.body).toMatchObject({ title: 'Recipe', content: 'Bread' });

    await request(server).delete(`/api/notes/${note.body.id}/share`).set(auth).expect(204);
    await request(server).get(`/api/public/notes/${share.body.token}`).expect(404);
  });
});

describe('import and export', () => {
  it('round-trips notes through a zip', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const notebook = await request(server).post('/api/notebooks').set(auth).send({ name: 'Recipes' });
    await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Bread', content: 'Flour, water', notebookId: notebook.body.id, tags: ['baking'] });

    const exported = await request(server)
      .get('/api/export')
      .set(auth)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const zip = await JSZip.loadAsync(exported.body as Buffer);
    expect(await zip.file('Recipes/Bread.md')?.async('string')).toContain('tags: [baking]');

    const other = await signUp();
    const imported = await request(server)
      .post('/api/import')
      .set(other.auth)
      .attach('files', exported.body as Buffer, 'export.zip')
      .expect(201);
    expect(imported.body).toEqual({ imported: 1, notebooksCreated: 1, skipped: [] });

    const list = await request(server).get('/api/notes?tag=baking').set(other.auth).expect(200);
    expect(list.body.items[0]).toMatchObject({ title: 'Bread', tags: ['baking'] });
  });
});
