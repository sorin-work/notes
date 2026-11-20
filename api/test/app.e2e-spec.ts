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
import { MAIL_TRANSPORT, MailTransport, OutgoingMail } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
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

describe('password reset', () => {
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** The token is in the fragment of the link, where no server log sees it. */
  const resetToken = (mail: OutgoingMail) =>
    /^http:\/\/notes\.test\/reset-password#token=([\w-]+)$/m.exec(mail.text)?.[1];
  const mailsTo = (address: string) => outbox.filter((message) => message.to === address);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

  it('sets a new password through the mailed link and ends every session', async () => {
    const server = app.getHttpServer();
    const email = `forgot-${Date.now()}@example.com`;
    const session = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Ada', password: 'password123' })
      .expect(201);

    const apiToken = await request(server)
      .post('/api/auth/tokens')
      .set(bearer(session.body.token))
      .send({ name: 'cron job', currentPassword: 'password123' })
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
    const token = resetToken(mail);
    expect(token).toBeDefined();
    // Nothing from the account is in the mail, only fixed text and the link.
    expect(mail.text).not.toContain('Ada');

    await request(server).post('/api/auth/password-reset/confirm').send({ token, password: 'short' }).expect(400);
    const done = await request(server)
      .post('/api/auth/password-reset/confirm')
      .send({ token, password: 'password456' })
      .expect(200);

    await request(server).get('/api/auth/me').set(bearer(session.body.token)).expect(401);
    await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(401);
    await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);

    // The answer signs the browser that did the reset in again.
    expect(done.body.user.email).toBe(email);
    const fresh = bearer(done.body.token);
    await request(server).get('/api/auth/me').set(fresh).expect(200);

    // The API token made before is still good. It is not revoked behind the
    // owner's back, but the new login can list it and end it with the rest.
    await request(server).get('/api/notes').set(bearer(apiToken.body.token)).expect(200);
    const listed = await request(server).get('/api/auth/tokens').set(fresh).expect(200);
    expect(listed.body.map((entry: { name: string }) => entry.name)).toEqual(['cron job']);
    const revoked = await request(server).delete('/api/auth/tokens').set(fresh).expect(200);
    expect(revoked.body).toEqual({ revoked: 1 });
    await request(server).get('/api/notes').set(bearer(apiToken.body.token)).expect(401);

    // The link worked once.
    await request(server).post('/api/auth/password-reset/confirm').send({ token, password: 'password789' }).expect(400);
    await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);
  });

  it('keeps an earlier link alive when asked again, and ends them all when one is used', async () => {
    const server = app.getHttpServer();
    const email = `twice-${Date.now()}@example.com`;
    await request(server).post('/api/auth/register').send({ email, name: 'Ada', password: 'password123' });

    await request(server).post('/api/auth/password-reset').send({ email }).expect(204);
    await mailTo(email);
    await request(server).post('/api/auth/password-reset').send({ email }).expect(204);
    while (mailsTo(email).length < 2) await settle();
    const [first, second] = mailsTo(email).map(resetToken);
    expect(first).not.toBe(second);

    // The second request did not cancel the first link.
    await request(server)
      .post('/api/auth/password-reset/confirm')
      .send({ token: first, password: 'password456' })
      .expect(200);
    // And once one is used, the other no longer sets a password.
    await request(server)
      .post('/api/auth/password-reset/confirm')
      .send({ token: second, password: 'password789' })
      .expect(400);
    await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);
  });

  it('has three links out per account at most, also when the requests come at once', async () => {
    const server = app.getHttpServer();
    const prisma = app.get(PrismaService);
    const email = `flood-${Date.now()}@example.com`;
    const account = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Ada', password: 'password123' });
    const ask = () => request(server).post('/api/auth/password-reset').send({ email }).expect(204);

    // Without the row lock every one of these would count zero links and add its own.
    await Promise.all([ask(), ask(), ask(), ask(), ask(), ask()]);
    await settle();
    await ask();
    await settle();

    expect(mailsTo(email)).toHaveLength(3);
    expect(await prisma.passwordReset.count({ where: { userId: account.body.user.id } })).toBe(3);
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

    const currentPassword = 'password123';
    await request(server).post('/api/auth/tokens').set(auth).send({ currentPassword }).expect(400);
    await request(server)
      .post('/api/auth/tokens')
      .set(auth)
      .send({ name: 'script', readOnly: null, currentPassword })
      .expect(400);
    // A login alone does not make a token: it would outlive that login.
    await request(server).post('/api/auth/tokens').set(auth).send({ name: 'script' }).expect(400);
    await request(server)
      .post('/api/auth/tokens')
      .set(auth)
      .send({ name: 'script', currentPassword: 'wrong-one' })
      .expect(403);
    expect((await request(server).get('/api/auth/tokens').set(auth).expect(200)).body).toEqual([]);

    const created = await request(server)
      .post('/api/auth/tokens')
      .set(auth)
      .send({ name: ' script ', currentPassword })
      .expect(201);
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
    await request(server).post('/api/auth/tokens').set(token).send({ name: 'more', currentPassword }).expect(403);
    await request(server).delete('/api/auth/tokens').set(token).expect(403);
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
      .send({ name: 'reader', readOnly: true, currentPassword })
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
    const make = (name: string) =>
      request(server).post('/api/auth/tokens').set(auth).send({ name, currentPassword: 'password123' }).expect(201);
    const first = await make('first');
    const second = await make('second');

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
      .overrideProvider(MAIL_TRANSPORT)
      .useValue(fakeTransport)
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

  it('caps the guesses against one account across the routes that check the password', async () => {
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
    const guessOnToken = (auth: { Authorization: string }) =>
      request(server).post('/api/auth/tokens').set(auth).send({ name: 'mine now', currentPassword: 'guess-4' });

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
    await guessOnToken(victim).expect(429);

    // The right password does not get through either until the minute is over.
    await request(server).delete('/api/auth/me').set(victim).send({ password: 'password123' }).expect(429);

    // Another account, from the same address, still has its own guesses.
    await guessOnPassword(other).expect(403);
    await guessOnToken(other).expect(403);
  });
});
