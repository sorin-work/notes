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
import { APP_CONFIG, loadConfig } from '../src/config/config';
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

describe('account', () => {
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('changes the name freely and the email only with the password', async () => {
    const server = app.getHttpServer();
    const { auth } = await signUp();
    const email = `renamed-${Date.now()}@example.com`;

    const renamed = await request(server).patch('/api/auth/me').set(auth).send({ name: '  Grace  ' }).expect(200);
    expect(renamed.body.name).toBe('Grace');

    // null is not "left out": both used to reach the database and answer 500.
    await request(server).patch('/api/auth/me').set(auth).send({ name: null }).expect(400);
    await request(server)
      .patch('/api/auth/me')
      .set(auth)
      .send({ email: null, currentPassword: 'password123' })
      .expect(400);
    await request(server).patch('/api/auth/me').set(auth).send({ name: 'Grace', currentPassword: null }).expect(400);
    await request(server).delete('/api/auth/me').set(auth).send({ password: null }).expect(400);
    await request(server)
      .patch('/api/auth/password')
      .set(auth)
      .send({ currentPassword: null, newPassword: 'password456' })
      .expect(400);

    await request(server).patch('/api/auth/me').set(auth).send({ email }).expect(400);
    // 403, not 401: the web app takes a 401 to mean the session is over.
    await request(server).patch('/api/auth/me').set(auth).send({ email, currentPassword: 'wrong-one' }).expect(403);
    const moved = await request(server)
      .patch('/api/auth/me')
      .set(auth)
      .send({ email: email.toUpperCase(), currentPassword: 'password123' })
      .expect(200);
    expect(moved.body).toMatchObject({ name: 'Grace', email });

    // The token still works, and the new address is the login name.
    await request(server).get('/api/auth/me').set(auth).expect(200);
    await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);

    const other = await signUp();
    await request(server)
      .patch('/api/auth/me')
      .set(other.auth)
      .send({ email, currentPassword: 'password123' })
      .expect(409);
  });

  it('ends the other sessions when the password changes', async () => {
    const server = app.getHttpServer();
    const email = `sessions-${Date.now()}@example.com`;
    const laptop = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Ada', password: 'password123' })
      .expect(201);
    const phone = await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);

    await request(server)
      .patch('/api/auth/password')
      .set(bearer(laptop.body.token))
      .send({ currentPassword: 'wrong-one', newPassword: 'password456' })
      .expect(403);
    const changed = await request(server)
      .patch('/api/auth/password')
      .set(bearer(laptop.body.token))
      .send({ currentPassword: 'password123', newPassword: 'password456' })
      .expect(200);

    await request(server).get('/api/notes').set(bearer(phone.body.token)).expect(401);
    await request(server).get('/api/notes').set(bearer(laptop.body.token)).expect(401);
    await request(server).get('/api/notes').set(bearer(changed.body.token)).expect(200);
  });

  it('signs out everywhere', async () => {
    const server = app.getHttpServer();
    const email = `everywhere-${Date.now()}@example.com`;
    const first = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Ada', password: 'password123' })
      .expect(201);
    const second = await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);

    await request(server).post('/api/auth/logout-all').set(bearer(first.body.token)).expect(204);

    await request(server).get('/api/auth/me').set(bearer(first.body.token)).expect(401);
    await request(server).get('/api/auth/me').set(bearer(second.body.token)).expect(401);
    const again = await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
    await request(server).get('/api/auth/me').set(bearer(again.body.token)).expect(200);
  });

  it('deletes the account and everything in it', async () => {
    const server = app.getHttpServer();
    const email = `leaving-${Date.now()}@example.com`;
    const account = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Ada', password: 'password123' })
      .expect(201);
    const auth = bearer(account.body.token);
    const note = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Going', tags: ['bye'] });
    const share = await request(server).post(`/api/notes/${note.body.id}/share`).set(auth).expect(200);

    await request(server).delete('/api/auth/me').set(auth).send({}).expect(400);
    await request(server).delete('/api/auth/me').set(auth).send({ password: 'wrong-one' }).expect(403);
    await request(server).get(`/api/notes/${note.body.id}`).set(auth).expect(200);

    await request(server).delete('/api/auth/me').set(auth).send({ password: 'password123' }).expect(204);

    await request(server).get('/api/notes').set(auth).expect(401);
    await request(server).get(`/api/public/notes/${share.body.token}`).expect(404);
    await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(401);
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

/**
 * The suites above run with a throttle limit too high to notice. This one
 * has an app of its own with a limit of three, to see the routes that check
 * the password count their requests at all.
 */
describe('password guesses with a low throttle limit', () => {
  let limited: INestApplication<App>;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...loadConfig(), authThrottleLimit: 3 })
      .compile();
    limited = moduleRef.createNestApplication();
    setupApp(limited);
    await limited.init();
  });

  afterAll(async () => {
    await limited.close();
  });

  const account = async (name: string) => {
    const response = await request(limited.getHttpServer())
      .post('/api/auth/register')
      .send({ email: `${name}-${Date.now()}@example.com`, name, password: 'password123' })
      .expect(201);
    return bearer(response.body.token);
  };

  it('caps the guesses against one account across the three routes together', async () => {
    const server = limited.getHttpServer();
    const victim = await account('victim');
    const other = await account('other');

    const guessOnProfile = (auth: { Authorization: string }) =>
      request(server).patch('/api/auth/me').set(auth).send({ email: 'x@example.com', currentPassword: 'guess-1' });
    const guessOnPassword = (auth: { Authorization: string }) =>
      request(server)
        .patch('/api/auth/password')
        .set(auth)
        .send({ currentPassword: 'guess-2', newPassword: 'password456' });
    const guessOnDelete = (auth: { Authorization: string }) =>
      request(server).delete('/api/auth/me').set(auth).send({ password: 'guess-3' });

    // One guess on each route uses up the three the account gets.
    await guessOnProfile(victim).expect(403);
    await guessOnPassword(victim).expect(403);
    await guessOnDelete(victim).expect(403);

    // Now every one of the three is closed, whichever comes next. A route
    // that lost its guard would answer 403 here.
    const refused = await guessOnPassword(victim).expect(429);
    expect(refused.headers['retry-after']).toBeDefined();
    await guessOnProfile(victim).expect(429);
    await guessOnDelete(victim).expect(429);

    // The right password does not get through either until the minute is over.
    await request(server).delete('/api/auth/me').set(victim).send({ password: 'password123' }).expect(429);

    // Another account, from the same address, still has its own guesses.
    await guessOnPassword(other).expect(403);
  });
});
