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
import { MAIL_TRANSPORT, MailTransport, OutgoingMail } from '../src/mail/mail.service';
import { setupApp } from '../src/setup-app';

process.env.JWT_SECRET ??= 'e2e-secret-that-is-long-enough-0123456789';
process.env.AUTH_THROTTLE_LIMIT ??= '1000';
process.env.SEED_DEMO = 'false';
// Mail is switched on, but nothing leaves the process: the transport below
// stands in for SMTP and keeps what it is given.
process.env.SMTP_HOST = 'smtp.invalid';
process.env.SMTP_FROM = 'Notes <notes@example.com>';
process.env.APP_URL = 'http://notes.test';

let app: INestApplication<App>;
let counter = 0;

const outbox: (OutgoingMail & { from: string })[] = [];
const fakeTransport: MailTransport = {
  sendMail: (message) => Promise.resolve(void outbox.push(message)),
};

/** Reset mails are sent after the request has been answered, so give them a moment. */
async function mailTo(address: string): Promise<OutgoingMail & { from: string }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const mail = outbox.find((message) => message.to === address);
    if (mail) return mail;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No mail to ${address}`);
}

async function signUp(): Promise<{ token: string; auth: { Authorization: string } }> {
  const email = `e2e-${Date.now()}-${++counter}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, name: 'E2E', password: 'password123' })
    .expect(201);
  return { token: response.body.token, auth: { Authorization: `Bearer ${response.body.token}` } };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(fakeTransport)
    .compile();
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

describe('password reset', () => {
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('sets a new password through the mailed link and ends every session', async () => {
    const server = app.getHttpServer();
    const email = `forgot-${Date.now()}@example.com`;
    const session = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Ada', password: 'password123' })
      .expect(201);

    const status = await request(server).get('/api/auth/password-reset').expect(200);
    expect(status.body).toEqual({ enabled: true });

    const asked = await request(server)
      .post('/api/auth/password-reset')
      .send({ email: email.toUpperCase() })
      .expect(204);
    expect(asked.text).toBe('');

    const mail = await mailTo(email);
    expect(mail.from).toBe('Notes <notes@example.com>');
    const token = /^http:\/\/notes\.test\/reset-password\?token=([\w-]+)$/m.exec(mail.text)?.[1];
    expect(token).toBeDefined();

    await request(server).post('/api/auth/password-reset/confirm').send({ token, password: 'short' }).expect(400);
    await request(server).post('/api/auth/password-reset/confirm').send({ token, password: 'password456' }).expect(204);

    await request(server).get('/api/auth/me').set(bearer(session.body.token)).expect(401);
    await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(401);
    await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);

    // The link worked once.
    await request(server).post('/api/auth/password-reset/confirm').send({ token, password: 'password789' }).expect(400);
    await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);
  });

  it('answers the same for an address without an account, and mails nothing', async () => {
    const server = app.getHttpServer();
    const nobody = `nobody-${Date.now()}@example.com`;
    const known = `somebody-${Date.now()}@example.com`;
    await request(server).post('/api/auth/register').send({ email: known, name: 'Ada', password: 'password123' });

    const forNobody = await request(server).post('/api/auth/password-reset').send({ email: nobody }).expect(204);
    const forKnown = await request(server).post('/api/auth/password-reset').send({ email: known }).expect(204);
    expect(forNobody.text).toBe(forKnown.text);

    // The request for the unknown address came first, so it is done by now.
    await mailTo(known);
    expect(outbox.some((message) => message.to === nobody)).toBe(false);

    await request(server).post('/api/auth/password-reset').send({ email: 'not-an-email' }).expect(400);
    await request(server)
      .post('/api/auth/password-reset/confirm')
      .send({ token: 'made-up-token', password: 'password456' })
      .expect(400);
  });
});

describe('api tokens', () => {
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('work in place of a login, within their limits', async () => {
    const server = app.getHttpServer();
    const { auth } = await signUp();

    await request(server).post('/api/auth/tokens').set(auth).send({}).expect(400);
    const created = await request(server).post('/api/auth/tokens').set(auth).send({ name: ' script ' }).expect(201);
    expect(created.body).toMatchObject({ name: 'script', readOnly: false, lastUsedAt: null });
    expect(created.body.token).toMatch(/^nt_[\w-]{43}$/);
    const token = bearer(created.body.token);

    // Shown once: the list has the name, never the token or its hash.
    const listed = await request(server).get('/api/auth/tokens').set(auth).expect(200);
    expect(listed.body).toEqual([
      { id: created.body.id, name: 'script', readOnly: false, lastUsedAt: null, createdAt: created.body.createdAt },
    ]);

    const note = await request(server).post('/api/notes').set(token).send({ title: 'From a script' }).expect(201);
    const notes = await request(server).get('/api/notes').set(token).expect(200);
    expect(notes.body.total).toBe(1);
    await request(server).get('/api/auth/me').set(token).expect(200);
    const used = await request(server).get('/api/auth/tokens').set(auth).expect(200);
    expect(used.body[0].lastUsedAt).not.toBeNull();

    // Managing the account and the tokens takes a login.
    await request(server).get('/api/auth/tokens').set(token).expect(403);
    await request(server).post('/api/auth/tokens').set(token).send({ name: 'more' }).expect(403);
    await request(server).delete(`/api/auth/tokens/${created.body.id}`).set(token).expect(403);
    await request(server).patch('/api/auth/me').set(token).send({ name: 'Mallory' }).expect(403);
    await request(server)
      .patch('/api/auth/password')
      .set(token)
      .send({ currentPassword: 'password123', newPassword: 'password456' })
      .expect(403);
    await request(server).post('/api/auth/logout-all').set(token).expect(403);
    await request(server).delete('/api/auth/me').set(token).send({ password: 'password123' }).expect(403);

    const reader = await request(server)
      .post('/api/auth/tokens')
      .set(auth)
      .send({ name: 'reader', readOnly: true })
      .expect(201);
    const readOnly = bearer(reader.body.token);
    await request(server).get(`/api/notes/${note.body.id}`).set(readOnly).expect(200);
    await request(server).get('/api/search?q=script').set(readOnly).expect(200);
    await request(server).post('/api/notes').set(readOnly).send({ title: 'No' }).expect(403);
    await request(server).patch(`/api/notes/${note.body.id}`).set(readOnly).send({ title: 'No' }).expect(403);
    await request(server).delete(`/api/notes/${note.body.id}`).set(readOnly).expect(403);
    await request(server).post(`/api/notes/${note.body.id}/share`).set(readOnly).expect(403);
    await request(server).get(`/api/notes/${note.body.id}`).set(auth).expect(200);
  });

  it('outlive "sign out everywhere", and end with a revoke or with the account', async () => {
    const server = app.getHttpServer();
    const email = `tokens-${Date.now()}@example.com`;
    const session = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Ada', password: 'password123' })
      .expect(201);
    const auth = bearer(session.body.token);
    const first = await request(server).post('/api/auth/tokens').set(auth).send({ name: 'first' }).expect(201);
    const second = await request(server).post('/api/auth/tokens').set(auth).send({ name: 'second' }).expect(201);

    await request(server).post('/api/auth/logout-all').set(auth).expect(204);
    await request(server).get('/api/notes').set(auth).expect(401);
    await request(server).get('/api/notes').set(bearer(first.body.token)).expect(200);

    const login = await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
    const again = bearer(login.body.token);
    const stranger = await signUp();
    await request(server).delete(`/api/auth/tokens/${first.body.id}`).set(stranger.auth).expect(404);
    await request(server).delete(`/api/auth/tokens/${first.body.id}`).set(again).expect(204);
    await request(server).delete(`/api/auth/tokens/${first.body.id}`).set(again).expect(404);
    await request(server).get('/api/notes').set(bearer(first.body.token)).expect(401);
    await request(server).get('/api/notes').set(bearer(second.body.token)).expect(200);

    await request(server).delete('/api/auth/me').set(again).send({ password: 'password123' }).expect(204);
    await request(server).get('/api/notes').set(bearer(second.body.token)).expect(401);
    await request(server).get('/api/notes').set(bearer('nt_made-up')).expect(401);
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
