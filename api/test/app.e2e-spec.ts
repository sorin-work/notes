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

describe('orphans and unlinked mentions', () => {
  it('lists the notes with no links in or out', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const post = async (body: object) =>
      (await request(server).post('/api/notes').set(auth).send(body).expect(201)).body.id as string;

    const linker = await post({ title: 'Hub', content: 'See [[ atlas  PLAN ]] and [[Nowhere]].' });
    const linked = await post({ title: 'Atlas plan', content: 'No links here.' });
    const alone = await post({ title: 'Alone', content: 'Mentions Hub in plain words only.', tags: ['solo'] });
    const trashed = await post({ title: 'Gone', content: 'See [[Stray]].' });
    const stray = await post({ title: 'Stray', content: 'Only linked from the trash.' });
    await request(server).delete(`/api/notes/${trashed}`).set(auth).expect(204);

    const orphans = async (query = '') => {
      const response = await request(server).get(`/api/notes?orphans=true&sort=title${query}`).set(auth).expect(200);
      return response.body.items.map((note: { id: string }) => note.id) as string[];
    };
    // "Hub" links out, "Atlas plan" is linked to, and a link from the trash does not count.
    expect(await orphans()).toEqual([alone, stray]);
    expect(await orphans('&tag=solo')).toEqual([alone]);
    const all = await request(server).get('/api/notes?orphans=false').set(auth).expect(200);
    expect(all.body.total).toBe(4);
    expect([linker, linked]).toHaveLength(2);
  });

  it('finds unlinked mentions and turns one into a link that can be undone', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const post = async (body: object, headers = auth) =>
      (await request(server).post('/api/notes').set(headers).send(body).expect(201)).body.id as string;
    const mentions = async (id: string, query = '') => {
      const response = await request(server).get(`/api/notes/${id}/mentions${query}`).set(auth).expect(200);
      return response.body as { items: { id: string; context: string }[]; total: number; capped: boolean };
    };

    const atlas = await post({ title: 'Project Atlas', content: 'The plan.' });
    const plain = await post({
      title: 'Minutes',
      content: '# Minutes\n\nWe agreed that project atlas ships in March.\n\nProject Atlas needs a budget.',
    });
    await post({ title: 'Linked', content: 'Already links to [[Project Atlas]], and names Project Atlas again.' });
    await post({ title: 'Code', content: 'Only in code: `Project Atlas`\n\n```\nProject Atlas\n```' });
    await post({ title: 'Stems', content: 'Projects and atlases, but never the two words together.' });
    await post({ title: 'Project Atlas notes', content: 'The title has the words, the text does not.' });
    const trashed = await post({ title: 'Old', content: 'Project Atlas, from the trash.' });
    await request(server).delete(`/api/notes/${trashed}`).set(auth).expect(204);
    await post({ title: 'Theirs', content: 'Project Atlas in another account.' }, other.auth);

    const found = await mentions(atlas);
    expect(found).toMatchObject({ total: 1, capped: false });
    expect(found.items).toEqual([
      expect.objectContaining({ id: plain, title: 'Minutes', context: 'We agreed that project atlas ships in March.' }),
    ]);
    expect((await mentions(atlas, '?page=2&pageSize=1')).items).toEqual([]);

    // Short titles, notes of other accounts and unknown notes get nothing.
    const short = await post({ title: 'We', content: 'x' });
    expect((await mentions(short)).total).toBe(0);
    await request(server).get(`/api/notes/${atlas}/mentions`).set(other.auth).expect(404);
    await request(server).post(`/api/notes/${atlas}/mentions/${plain}/link`).set(other.auth).expect(404);

    const before = await request(server).get(`/api/notes/${plain}`).set(auth).expect(200);
    await request(server).post(`/api/notes/${atlas}/mentions/${plain}/link`).set(auth).expect(204);
    const after = await request(server).get(`/api/notes/${plain}`).set(auth).expect(200);
    expect(after.body.content).toBe(
      '# Minutes\n\nWe agreed that [[project atlas]] ships in March.\n\nProject Atlas needs a budget.',
    );
    // The app made this change, so the note keeps its place in "last edited".
    expect(after.body.updatedAt).toBe(before.body.updatedAt);

    // It is a backlink now and no longer a mention, and the old text is in the history.
    const backlinks = await request(server).get(`/api/notes/${atlas}/backlinks`).set(auth).expect(200);
    expect(backlinks.body.map((link: { id: string }) => link.id)).toContain(plain);
    expect((await mentions(atlas)).total).toBe(0);
    const versions = await request(server).get(`/api/notes/${plain}/versions`).set(auth).expect(200);
    expect(versions.body).toHaveLength(1);
    const version = await request(server).get(`/api/notes/${plain}/versions/${versions.body[0].id}`).set(auth);
    expect(version.body.content).toBe(before.body.content);

    // Asked again, it links the next mention. When none is left it says so and changes nothing.
    await request(server).post(`/api/notes/${atlas}/mentions/${plain}/link`).set(auth).expect(204);
    const twice = await request(server).get(`/api/notes/${plain}`).set(auth).expect(200);
    expect(twice.body.content).toContain('[[Project Atlas]] needs a budget.');
    await request(server).post(`/api/notes/${atlas}/mentions/${plain}/link`).set(auth).expect(409);
    // The search index follows the new text.
    const search = await request(server).get('/api/search').query({ q: '"project atlas ships"' }).set(auth);
    expect(search.body.items.map((hit: { id: string }) => hit.id)).toEqual([plain]);
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
