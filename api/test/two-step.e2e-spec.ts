import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { base32Decode, codeAt, stepAt } from '../src/auth/totp';
import { MAIL_TRANSPORT, MailTransport, OutgoingMail } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

process.env.JWT_SECRET ??= 'e2e-secret-that-is-long-enough-0123456789';
process.env.AUTH_THROTTLE_LIMIT ??= '1000';
process.env.SEED_DEMO = 'false';
process.env.TWO_STEP_KEY = 'cd'.repeat(32);
process.env.SMTP_HOST = 'smtp.invalid';
process.env.SMTP_FROM = 'Notes <notes@example.com>';
process.env.APP_URL = 'http://notes.test';
const attachmentsDir = mkdtempSync(join(tmpdir(), 'notes-e2e-two-step-'));
process.env.ATTACHMENTS_DIR = attachmentsDir;

const outbox: (OutgoingMail & { from: string })[] = [];
const fakeTransport: MailTransport = { sendMail: (message) => Promise.resolve(void outbox.push(message)) };

let app: INestApplication<App>;
let counter = 0;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

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
  rmSync(attachmentsDir, { recursive: true, force: true });
});

async function account(): Promise<{ email: string; token: string }> {
  const email = `two-step-${Date.now()}-${++counter}@example.com`;
  const response = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, name: 'Two Step', password: 'password123' })
    .expect(201);
  return { email, token: response.body.token };
}

/** The code of the step `ahead` steps from now. The server takes one step either side. */
const code = (secret: Buffer, ahead = 0) => codeAt(secret, stepAt(new Date()) + ahead);

async function mailTo(address: string, seen = 0): Promise<OutgoingMail> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const mails = outbox.filter((message) => message.to === address);
    if (mails.length > seen) return mails[mails.length - 1]!;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`No mail to ${address}`);
}

/** Turns codes on for a new account. Answers the secret, the recovery codes and the token that still works. */
async function withCodes() {
  const server = app.getHttpServer();
  const { email, token } = await account();
  const setup = await request(server)
    .post('/api/auth/two-step/setup')
    .set(bearer(token))
    .send({ currentPassword: 'password123' })
    .expect(201);
  const secret = base32Decode(setup.body.secret);
  const enabled = await request(server)
    .post('/api/auth/two-step/enable')
    .set(bearer(token))
    .send({ code: code(secret) })
    .expect(201);
  return {
    email,
    secret,
    oldToken: token,
    token: enabled.body.token as string,
    recoveryCodes: enabled.body.recoveryCodes as string[],
  };
}

describe('two-step sign-in', () => {
  it('is turned on with the first code, ends the other sessions, and shows ten recovery codes', async () => {
    const server = app.getHttpServer();
    const { email, token } = await account();
    await request(server)
      .post('/api/auth/two-step/setup')
      .set(bearer(token))
      .send({ currentPassword: 'wrong' })
      .expect(403);
    const setup = await request(server)
      .post('/api/auth/two-step/setup')
      .set(bearer(token))
      .send({ currentPassword: 'password123' })
      .expect(201);
    expect(setup.body.uri).toContain(`secret=${setup.body.secret}`);
    // Not on until a code from the app has been given.
    expect((await request(server).get('/api/auth/two-step').set(bearer(token)).expect(200)).body).toEqual({
      available: true,
      on: false,
      recoveryCodesLeft: 0,
    });
    await request(server).post('/api/auth/two-step/enable').set(bearer(token)).send({ code: '000000' }).expect(403);

    const enabled = await request(server)
      .post('/api/auth/two-step/enable')
      .set(bearer(token))
      .send({ code: code(base32Decode(setup.body.secret)) })
      .expect(201);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    expect(enabled.body.user).toMatchObject({ email, twoStep: true });
    await request(server).get('/api/auth/me').set(bearer(token)).expect(401);
    const status = await request(server).get('/api/auth/two-step').set(bearer(enabled.body.token)).expect(200);
    expect(status.body).toEqual({ available: true, on: true, recoveryCodesLeft: 10 });

    // The secret is kept encrypted, and the JSON backup has nothing of it.
    const row = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email } });
    expect(row.twoStepSecret).toMatch(/^v1\./);
    expect(row.twoStepSecret).not.toContain(setup.body.secret);
    const backup = await request(server)
      .get('/api/export/backup')
      .set(bearer(enabled.body.token))
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => done(null, body));
      })
      .expect(200);
    const text = backup.body as string;
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain(row.twoStepSecret!);
    expect(text).not.toMatch(/twoStep|recovery/i);
  });

  it('asks for a code after the password, takes it once, and the ticket is no login', async () => {
    const server = app.getHttpServer();
    const { email, secret } = await withCodes();

    const first = await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
    expect(first.body).toEqual({ twoStep: true, ticket: expect.any(String) });
    await request(server).get('/api/auth/me').set(bearer(first.body.ticket)).expect(401);

    await request(server).post('/api/auth/login/code').send({ ticket: first.body.ticket, code: '000000' }).expect(403);
    // One step ahead, so it comes after the step that turned codes on.
    const next = code(secret, 1);
    const signedIn = await request(server)
      .post('/api/auth/login/code')
      .send({ ticket: first.body.ticket, code: next })
      .expect(200);
    await request(server).get('/api/auth/me').set(bearer(signedIn.body.token)).expect(200);

    // The same code, with a fresh ticket, does not work twice.
    const second = await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
    await request(server).post('/api/auth/login/code').send({ ticket: second.body.ticket, code: next }).expect(403);
  });

  it('uses a ticket up after five wrong codes, while a new ticket still works', async () => {
    const server = app.getHttpServer();
    const { email, recoveryCodes } = await withCodes();
    const login = () => request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);

    const { ticket } = (await login()).body;
    for (let attempt = 0; attempt < 5; attempt++) {
      await request(server).post('/api/auth/login/code').send({ ticket, code: '000000' }).expect(403);
    }
    await request(server).post('/api/auth/login/code').send({ ticket, code: recoveryCodes[0] }).expect(429);
    const again = (await login()).body;
    await request(server)
      .post('/api/auth/login/code')
      .send({ ticket: again.ticket, code: recoveryCodes[0] })
      .expect(200);
    // The owner hears that someone with the password got the code wrong.
    expect((await mailTo(email)).subject).toBe('Someone has your Notes password');
  });

  it('takes a recovery code once, for signing in or for a new API token', async () => {
    const server = app.getHttpServer();
    const { email, token, recoveryCodes } = await withCodes();

    const ticket = (await request(server).post('/api/auth/login').send({ email, password: 'password123' })).body.ticket;
    await request(server)
      .post('/api/auth/login/code')
      .send({ ticket, code: recoveryCodes[0]!.toUpperCase() })
      .expect(200);
    const reused = (await request(server).post('/api/auth/login').send({ email, password: 'password123' })).body.ticket;
    await request(server).post('/api/auth/login/code').send({ ticket: reused, code: recoveryCodes[0] }).expect(403);

    // The password alone makes no API token any more.
    await request(server)
      .post('/api/auth/tokens')
      .set(bearer(token))
      .send({ name: 'script', currentPassword: 'password123' })
      .expect(403);
    await request(server)
      .post('/api/auth/tokens')
      .set(bearer(token))
      .send({ name: 'script', currentPassword: 'password123', code: recoveryCodes[1] })
      .expect(201);
    const status = await request(server).get('/api/auth/two-step').set(bearer(token)).expect(200);
    expect(status.body.recoveryCodesLeft).toBe(8);
  });

  it('still asks for the code after a password reset by mail', async () => {
    const server = app.getHttpServer();
    const { email, recoveryCodes } = await withCodes();
    await request(server).post('/api/auth/password-reset').send({ email }).expect(204);
    const link = /#token=([\w-]+)/.exec((await mailTo(email)).text)?.[1] ?? '';
    await request(server)
      .post('/api/auth/password-reset/confirm')
      .send({ token: link, password: 'password456' })
      .expect(204);
    const login = await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);
    expect(login.body).toEqual({ twoStep: true, ticket: expect.any(String) });
    await request(server)
      .post('/api/auth/login/code')
      .send({ ticket: login.body.ticket, code: recoveryCodes[0] })
      .expect(200);
  });

  it('is turned off with the password and a code, and signing in is one step again', async () => {
    const server = app.getHttpServer();
    const { email, token, recoveryCodes } = await withCodes();
    await request(server)
      .post('/api/auth/two-step/disable')
      .set(bearer(token))
      .send({ currentPassword: 'password123', code: '000000' })
      .expect(403);
    await request(server)
      .post('/api/auth/two-step/disable')
      .set(bearer(token))
      .send({ currentPassword: 'password123', code: recoveryCodes[0] })
      .expect(204);
    const login = await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
    expect(login.body.token).toEqual(expect.any(String));
    const row = await app.get(PrismaService).user.findUniqueOrThrow({ where: { email } });
    expect(row).toMatchObject({ twoStepSecret: null, twoStepSince: null });
  });
});

describe('a new email address', () => {
  it('waits for the link mailed to it, tells the old address, and the link works once', async () => {
    const server = app.getHttpServer();
    const { email, token } = await account();
    const next = `moved-${Date.now()}-${++counter}@example.com`;
    const changed = await request(server)
      .patch('/api/auth/me')
      .set(bearer(token))
      .send({ email: next, currentPassword: 'password123' })
      .expect(200);
    expect(changed.body).toMatchObject({ email, pendingEmail: next });
    expect((await mailTo(email)).text).toContain(next);

    // Until the link is opened the old address is still the login name.
    await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(200);
    const link = /#token=([\w-]+)/.exec((await mailTo(next)).text)?.[1] ?? '';
    await request(server).post('/api/auth/email/confirm').send({ token: link }).expect(204);
    await request(server).post('/api/auth/email/confirm').send({ token: link }).expect(400);
    await request(server).post('/api/auth/login').send({ email: next, password: 'password123' }).expect(200);
    await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(401);
  });

  it('is cancelled by a new password', async () => {
    const server = app.getHttpServer();
    const { email, token } = await account();
    const next = `cancelled-${Date.now()}-${++counter}@example.com`;
    await request(server)
      .patch('/api/auth/me')
      .set(bearer(token))
      .send({ email: next, currentPassword: 'password123' })
      .expect(200);
    const link = /#token=([\w-]+)/.exec((await mailTo(next)).text)?.[1] ?? '';
    const renewed = await request(server)
      .patch('/api/auth/password')
      .set(bearer(token))
      .send({ currentPassword: 'password123', newPassword: 'password456' })
      .expect(200);
    expect(renewed.body.user.pendingEmail).toBeNull();
    await request(server).post('/api/auth/email/confirm').send({ token: link }).expect(400);
    await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);
  });
});
