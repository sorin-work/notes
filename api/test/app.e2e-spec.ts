/**
 * End-to-end tests against a real Postgres database. Run with
 * `npm run test:e2e` and DATABASE_URL pointing at a database (or a schema,
 * e.g. ?schema=e2e) that the tests may write to. Every test signs up its own
 * user, so the tests do not interfere with each other or with existing data.
 */
import { INestApplication, RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryModule, DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ALLOW_API_TOKEN } from '../src/common/allow-api-token.decorator';
import { IS_PUBLIC } from '../src/common/public.decorator';
import { APP_CONFIG, AppConfig, loadConfig } from '../src/config/config';
import { setupDocs } from '../src/docs';
import { LinksService } from '../src/links/links.service';
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

interface RegisteredRoute {
  /** "NotesController.list" */
  name: string;
  verb: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** With a made-up id in place of every parameter. */
  path: string;
  /** As the API document writes it: "/api/notes/{id}". */
  documented: string;
  isPublic: boolean;
  allowsToken: boolean;
}

/** Every route of every controller, with the marks JwtAuthGuard reads on it. */
function registeredRoutes(nest: INestApplication): RegisteredRoute[] {
  const reflector = nest.get(Reflector);
  const scanner = new MetadataScanner();
  const first = (value: string | string[] | undefined) => [value ?? ''].flat()[0];
  const routes: RegisteredRoute[] = [];
  for (const { metatype } of nest.get(DiscoveryService).getControllers()) {
    const controller = metatype as Type | undefined;
    if (!controller) continue;
    const prototype = controller.prototype as Record<string, (...args: unknown[]) => unknown>;
    for (const method of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[method];
      const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (verb === undefined) continue;
      const parts = [
        first(Reflect.getMetadata(PATH_METADATA, controller)),
        first(Reflect.getMetadata(PATH_METADATA, handler)),
      ];
      const path = ['/api', ...parts.map((part) => part.replace(/^\/|\/$/g, '')).filter(Boolean)].join('/');
      const targets = [handler, controller];
      routes.push({
        name: `${controller.name}.${method}`,
        verb: RequestMethod[verb].toLowerCase() as RegisteredRoute['verb'],
        path: path.replace(/:\w+/g, '6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e'),
        documented: path.replace(/:(\w+)/g, '{$1}'),
        isPublic: reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) === true,
        allowsToken: reflector.getAllAndOverride<boolean>(ALLOW_API_TOKEN, targets) === true,
      });
    }
  }
  return routes;
}

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
  // DiscoveryModule is for registeredRoutes above.
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, DiscoveryModule] })
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(fakeTransport)
    .compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  setupDocs(app);
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

    await request(server).get('/api/notes').set(bearer(apiToken.body.token)).expect(200);
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
      .expect(204);
    expect(done.text).toBe('');

    await request(server).get('/api/auth/me').set(bearer(session.body.token)).expect(401);
    await request(server).post('/api/auth/login').send({ email, password: 'password123' }).expect(401);
    await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);

    // A reset is the way back into an account someone else may have been
    // in, so the API token made with the old password goes with the logins.
    await request(server).get('/api/notes').set(bearer(apiToken.body.token)).expect(401);
    const login = await request(server).post('/api/auth/login').send({ email, password: 'password456' }).expect(200);
    const listed = await request(server).get('/api/auth/tokens').set(bearer(login.body.token)).expect(200);
    expect(listed.body).toEqual([]);

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
      .expect(204);
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

describe('api docs', () => {
  type Operation = {
    security: Record<string, string[]>[];
    tags: string[];
    summary?: string;
    parameters?: { name: string }[];
    requestBody?: { content: Record<string, { schema: { properties: Record<string, unknown>; required?: string[] } }> };
  };
  type Document = {
    paths: Record<string, Record<string, Operation>>;
    components: {
      securitySchemes: Record<string, { type: string; scheme: string }>;
      schemas: Record<string, { properties: Record<string, Record<string, unknown>>; required?: string[] }>;
    };
  };

  it('serves the page and the document without a login', async () => {
    const server = app.getHttpServer();
    const page = await request(server).get('/api/docs').expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('Notes API');
    const json = await request(server).get('/api/docs-json').expect(200);
    expect(json.body.info.title).toBe('Notes API');
  });

  it('serves its own page and files under /api/docs and nothing else from the swagger package', async () => {
    const server = app.getHttpServer();
    const page = await request(server).get('/api/docs').expect(200);

    // Everything the page loads is a file next to it, never another host.
    const loaded = [...page.text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    expect(loaded.length).toBeGreaterThan(3);
    for (const file of loaded) {
      expect(file).toMatch(/^\.\/docs\/[\w.-]+$/);
      await request(server).get(file.replace(/^\./, '/api')).expect(200);
    }
    const init = await request(server).get('/api/docs/swagger-ui-init.js').buffer(true).expect(200);
    expect(init.text).not.toContain('petstore');
    expect(init.text).not.toMatch(/https?:\/\/(?!localhost)[a-z0-9.-]+\.swagger\.io/);

    // The package's stock page, which loads a sample document from petstore.swagger.io, and the rest of its folder.
    for (const path of [
      '/api/docs/docs/',
      '/api/docs/docs',
      '/api/docs/index.html',
      '/api/docs/docs/index.html',
      '/api/docs/swagger-initializer.js',
      '/api/docs/docs/swagger-initializer.js',
      '/api/docs/docs/swagger-ui.css',
      '/api/docs/oauth2-redirect.html',
      '/api/docs/package.json',
      '/api/docs/swagger-ui-bundle.js.map',
    ]) {
      const response = await request(server).get(path);
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }
    await request(server).get('/api/docs/').expect(200);
  });

  it('gives every operation a line on what it does, and the import its upload', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const document = body as Document;
    const missing = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([, operation]) => !operation.summary)
        .map(([method]) => `${method.toUpperCase()} ${path}`),
    );
    expect(missing).toEqual([]);

    const upload = document.paths['/api/import'].post.requestBody?.content['multipart/form-data'].schema;
    expect(upload?.required).toEqual(['files']);
    expect(upload?.properties.files).toMatchObject({ type: 'array', items: { type: 'string', format: 'binary' } });
  });

  it('describes both kinds of credential and says which routes take which', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const document = body as Document;
    expect(document.components.securitySchemes).toMatchObject({
      login: { type: 'http', scheme: 'bearer' },
      apiToken: { type: 'http', scheme: 'bearer' },
    });

    const takes = (method: string, path: string) =>
      document.paths[path][method].security.map((entry) => Object.keys(entry)[0]);
    // Public, as the guard has it.
    expect(takes('post', '/api/auth/login')).toEqual([]);
    expect(takes('get', '/api/public/notes/{token}')).toEqual([]);
    expect(takes('get', '/api/health')).toEqual([]);
    // Either credential.
    expect(takes('get', '/api/notes')).toEqual(['login', 'apiToken']);
    expect(takes('get', '/api/auth/me')).toEqual(['login', 'apiToken']);
    // A login only: the account and the tokens.
    expect(takes('patch', '/api/auth/me')).toEqual(['login']);
    expect(takes('post', '/api/auth/tokens')).toEqual(['login']);
    expect(takes('delete', '/api/auth/tokens/{id}')).toEqual(['login']);
    expect(takes('delete', '/api/auth/tokens')).toEqual(['login']);

    // And for every route the app has, the document says what the guard will do.
    const routes = registeredRoutes(app);
    expect(routes.length).toBeGreaterThan(40);
    for (const route of routes) {
      const expected = route.isPublic ? [] : route.allowsToken ? ['login', 'apiToken'] : ['login'];
      expect({ route: route.name, takes: takes(route.verb, route.documented) }).toEqual({
        route: route.name,
        takes: expected,
      });
    }

    // No operation is left without a statement, and each has a group.
    const operations = Object.values(document.paths).flatMap((item) => Object.values(item));
    expect(operations.length).toBeGreaterThan(40);
    expect(operations.every((operation) => Array.isArray(operation.security))).toBe(true);
    expect(document.paths['/api/notes/{noteId}/versions'].get.tags).toEqual(['notes']);
  });

  it('takes the request bodies and queries from the classes the API validates with', async () => {
    const { body } = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const { schemas } = (body as Document).components;

    expect(schemas.RegisterDto.required).toEqual(['email', 'name', 'password']);
    expect(schemas.RegisterDto.properties.password).toMatchObject({ type: 'string', minLength: 8, maxLength: 72 });
    expect(schemas.RegisterDto.properties.email).toMatchObject({ format: 'email' });
    expect(Object.keys(schemas.CreateNoteDto.properties)).toEqual(
      expect.arrayContaining(['title', 'content', 'notebookId', 'tags', 'pinned', 'favorite']),
    );
    expect(schemas.CreateApiTokenDto.required).toEqual(['name', 'currentPassword']);

    const query = (path: string) => (body as Document).paths[path].get.parameters?.map((parameter) => parameter.name);
    expect(query('/api/notes')).toEqual(expect.arrayContaining(['notebookId', 'tag', 'sort', 'page', 'pageSize']));
    expect(query('/api/search')).toEqual(expect.arrayContaining(['q', 'notebookId', 'tag', 'page']));
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

  it('outlive a password change, and can then be revoked all at once', async () => {
    const server = app.getHttpServer();
    const email = `rotate-${Date.now()}@example.com`;
    const session = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Ada', password: 'password123' })
      .expect(201);
    const make = (name: string) =>
      request(server)
        .post('/api/auth/tokens')
        .set(bearer(session.body.token))
        .send({ name, currentPassword: 'password123' })
        .expect(201);
    const first = await make('first');
    const second = await make('second');

    const changed = await request(server)
      .patch('/api/auth/password')
      .set(bearer(session.body.token))
      .send({ currentPassword: 'password123', newPassword: 'password456' })
      .expect(200);
    const auth = bearer(changed.body.token);

    // Kept on purpose, and the new login can see that they are.
    await request(server).get('/api/notes').set(bearer(first.body.token)).expect(200);
    const kept = await request(server).get('/api/auth/tokens').set(auth).expect(200);
    expect(kept.body).toHaveLength(2);

    const stranger = await signUp();
    expect((await request(server).delete('/api/auth/tokens').set(stranger.auth).expect(200)).body).toEqual({
      revoked: 0,
    });
    await request(server).get('/api/notes').set(bearer(second.body.token)).expect(200);

    expect((await request(server).delete('/api/auth/tokens').set(auth).expect(200)).body).toEqual({ revoked: 2 });
    await request(server).get('/api/notes').set(bearer(first.body.token)).expect(401);
    await request(server).get('/api/notes').set(bearer(second.body.token)).expect(401);
  });

  it('get into the routes that are marked for them and into no other', async () => {
    const server = app.getHttpServer();
    const { auth } = await signUp();
    const created = await request(server)
      .post('/api/auth/tokens')
      .set(auth)
      .send({ name: 'walker', currentPassword: 'password123' })
      .expect(201);
    const token = bearer(created.body.token);

    const routes = registeredRoutes(app);
    expect(routes.length).toBeGreaterThan(40);
    const names = (list: typeof routes) => list.map((route) => route.name).sort();
    const open = routes.filter((route) => !route.isPublic && route.allowsToken);
    const closed = routes.filter((route) => !route.isPublic && !route.allowsToken);

    // Every route nobody marked refuses a full-access token, whatever it is asked to do.
    for (const route of closed) {
      const response = await request(server)[route.verb](route.path).set(token).send({});
      expect({ route: route.name, status: response.status, message: response.body.message }).toEqual({
        route: route.name,
        status: 403,
        message: 'An API token cannot do this. Sign in instead.',
      });
    }

    // Written out, so that opening a route to tokens, or making one public,
    // cannot happen without this list changing with it.
    expect(names(closed)).toEqual([
      'ApiTokensController.create',
      'ApiTokensController.list',
      'ApiTokensController.revoke',
      'ApiTokensController.revokeAll',
      'AuthController.changePassword',
      'AuthController.deleteAccount',
      'AuthController.logoutEverywhere',
      'AuthController.updatePreferences',
      'AuthController.updateProfile',
      'InvitesController.accept',
      'InvitesController.acceptByToken',
      'InvitesController.decline',
      'InvitesController.received',
      'MembersController.changeRole',
      'MembersController.invite',
      'MembersController.list',
      'MembersController.remove',
      'MembersController.revoke',
    ]);
    expect(names(routes.filter((route) => route.isPublic))).toEqual([
      'AuthController.login',
      'AuthController.register',
      'HealthController.check',
      'PasswordResetController.confirm',
      'PasswordResetController.request',
      'PasswordResetController.status',
      'PublicSharesController.unlock',
      'PublicSharesController.view',
      'PublicSharesController.viewNote',
      'TransferController.downloadBackup',
    ]);
    expect([...new Set(open.map((route) => route.name.split('.')[0]))].sort()).toEqual([
      'AuthController',
      'NotebookSharesController',
      'NotebooksController',
      'NotesController',
      'SearchController',
      'SharesController',
      'TagsController',
      'TransferController',
      'TrashController',
      'VersionsController',
    ]);
    expect(names(open.filter((route) => route.name.startsWith('AuthController')))).toEqual(['AuthController.me']);
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
    expect(renamed.body).toEqual({
      updated: 2,
      skipped: 0,
      title: 'Project Atlas',
      noteIds: expect.arrayContaining([sync.id, ideas.id]),
    });
    expect(renamed.body.noteIds).toHaveLength(2);

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

    // A note with no title is stored as "Untitled", which is nothing to link to.
    await request(server).patch(`/api/notes/${target.id}`).set(auth).send({ title: '' }).expect(200);
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 0 });
    expect((await renameLinks(auth, target.id, { from: 'Atlas' }).expect(200)).body.updated).toBe(0);

    // When a second note has the new title, the links could end up leading to that one.
    const namesake = await createNote(auth, 'Plan');
    await request(server).patch(`/api/notes/${target.id}`).set(auth).send({ title: 'plan' }).expect(200);
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 0 });
    expect((await renameLinks(auth, target.id, { from: 'Atlas' }).expect(200)).body.noteIds).toEqual([]);
    expect((await getNote(auth, source.id)).content).toBe('About [[Atlas]].');
    await request(server).delete(`/api/notes/${namesake.id}`).set(auth).expect(204);
    expect(await orphaned(auth, target.id, 'Atlas')).toEqual({ count: 1 });

    await renameLinks(auth, target.id, {}).expect(400);
    await renameLinks(auth, target.id, { from: '   ' }).expect(400);
    // The database cannot take a null character. That is a bad request, not a server error.
    await renameLinks(auth, target.id, { from: 'At\0las' }).expect(400);
    await request(server).get(`/api/notes/${target.id}/rename-links?from=At%00las`).set(auth).expect(400);
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

describe('editing in two places', () => {
  type Auth = { Authorization: string };
  const patch = (auth: Auth, id: string, body: object) =>
    request(app.getHttpServer()).patch(`/api/notes/${id}`).set(auth).send(body);
  const read = async (auth: Auth, id: string) =>
    (await request(app.getHttpServer()).get(`/api/notes/${id}`).set(auth).expect(200)).body;
  const create = async (auth: Auth, body: object) =>
    (await request(app.getHttpServer()).post('/api/notes').set(auth).send(body).expect(201)).body;

  it('refuses a save based on an old revision and hands back the note as it is', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const note = await create(auth, { title: 'Plan', content: 'One' });
    expect(note.revision).toBe(0);

    // Two tabs have the note open at revision 0. The first one to save gets through.
    expect((await patch(auth, note.id, { content: 'From tab A', revision: 0 }).expect(200)).body.revision).toBe(1);
    const refused = await patch(auth, note.id, { content: 'From tab B', tags: ['late'], revision: 0 }).expect(409);
    expect(refused.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      code: 'stale_revision',
      message: expect.any(String),
      note: expect.objectContaining({ id: note.id, content: 'From tab A', revision: 1, tags: [] }),
    });
    // Nothing of the refused request was applied, not even its tags.
    expect(await read(auth, note.id)).toMatchObject({ content: 'From tab A', tags: [], revision: 1 });

    // Pinning, tags and moving never conflict and never count as a revision.
    const pinned = await patch(auth, note.id, { pinned: true, tags: ['later'], revision: 0 }).expect(200);
    expect(pinned.body).toMatchObject({ pinned: true, tags: ['later'], content: 'From tab A', revision: 1 });
    // Neither does saving the text the note already has.
    expect((await patch(auth, note.id, { content: 'From tab A', revision: 1 }).expect(200)).body.revision).toBe(1);

    // "Keep mine, put theirs in the history": based on the new revision, with a version forced.
    const kept = await patch(auth, note.id, { content: 'From tab B', revision: 1, keepVersion: true }).expect(200);
    expect(kept.body).toMatchObject({ content: 'From tab B', revision: 2 });
    const versions = await request(server).get(`/api/notes/${note.id}/versions`).set(auth).expect(200);
    const latest = await request(server).get(`/api/notes/${note.id}/versions/${versions.body[0].id}`).set(auth);
    expect(latest.body.content).toBe('From tab A');

    // A client that names no revision keeps working: the last write wins, and it still counts.
    expect((await patch(auth, note.id, { title: 'Plan C' }).expect(200)).body).toMatchObject({
      title: 'Plan C',
      content: 'From tab B',
      revision: 3,
    });

    for (const revision of [-1, 1.5, '3', 2147483648]) {
      await patch(auth, note.id, { content: 'x', revision }).expect(400);
    }
  });

  it('lets one of two saves that race from the same revision through, never both', async () => {
    const { auth } = await signUp();
    for (let round = 0; round < 5; round++) {
      const note = await create(auth, { title: `Race ${round}`, content: 'Start' });
      const answers = await Promise.all([
        patch(auth, note.id, { content: 'First tab', revision: 0 }),
        patch(auth, note.id, { content: 'Second tab', revision: 0 }),
      ]);
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
      const [won] = answers.filter((answer) => answer.status === 200);
      const [lost] = answers.filter((answer) => answer.status === 409);
      expect(won.body.revision).toBe(1);
      expect(lost.body.note).toMatchObject({ content: won.body.content, revision: 1 });
      expect(await read(auth, note.id)).toMatchObject({ content: won.body.content, revision: 1 });
    }
  });

  it('counts every change of the text, whoever makes it', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const target = await create(auth, { title: 'Atlas' });
    const source = await create(auth, { title: 'Source', content: 'About [[Atlas]].' });

    // Rewriting links after a rename is a change of the text of the other note.
    await patch(auth, target.id, { title: 'Project Atlas', revision: 0 }).expect(200);
    await request(server).post(`/api/notes/${target.id}/rename-links`).set(auth).send({ from: 'Atlas' }).expect(200);
    expect(await read(auth, source.id)).toMatchObject({ content: 'About [[Project Atlas]].', revision: 1 });
    // A tab that still has the old text of that note is told so.
    await patch(auth, source.id, { content: 'About [[Atlas]] and more.', revision: 0 }).expect(409);

    // Restoring a version too.
    await patch(auth, source.id, { content: 'Rewritten', revision: 1 }).expect(200);
    const versions = await request(server).get(`/api/notes/${source.id}/versions`).set(auth).expect(200);
    const restored = await request(server)
      .post(`/api/notes/${source.id}/versions/${versions.body.at(-1).id}/restore`)
      .set(auth)
      .expect(200);
    expect(restored.body).toMatchObject({ content: 'About [[Atlas]].', revision: 3 });
    await patch(auth, source.id, { content: 'Typed before the restore', revision: 2 }).expect(409);

    // The trash does not touch the text.
    await request(server).delete(`/api/notes/${source.id}`).set(auth).expect(204);
    await request(server).post(`/api/trash/${source.id}/restore`).set(auth).expect(204);
    expect((await read(auth, source.id)).revision).toBe(3);

    // And so does a write that goes past the services: the database does the counting.
    const prisma = app.get(PrismaService);
    await prisma.note.update({ where: { id: source.id }, data: { pinned: true } });
    expect((await read(auth, source.id)).revision).toBe(3);
    await prisma.note.update({ where: { id: source.id }, data: { content: 'Changed by hand' } });
    expect((await read(auth, source.id)).revision).toBe(4);
    await prisma.$executeRaw`UPDATE notes SET title = 'By hand' WHERE id = ${source.id}::uuid`;
    expect((await read(auth, source.id)).revision).toBe(5);
  });
});

describe('notes made offline', () => {
  it('takes an id made by the client once, and answers the same to anyone who sends it again', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const id = randomUUID();

    const made = await request(server).post('/api/notes').set(auth).send({ id, title: 'On the train', content: 'x' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ id, title: 'On the train', revision: 0 });

    // The same create sent again, say after a lost answer: one note, and a 409 that says why.
    const again = await request(server).post('/api/notes').set(auth).send({ id, title: 'On the train' }).expect(409);
    expect(again.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'A note with this id already exists.',
      code: 'note_exists',
    });
    // Someone else gets exactly the same answer, and learns nothing about the note.
    const theirs = await request(server).post('/api/notes').set(other.auth).send({ id, title: 'Mine?' }).expect(409);
    expect(theirs.body).toEqual(again.body);
    await request(server).get(`/api/notes/${id}`).set(other.auth).expect(404);
    expect((await request(server).get(`/api/notes/${id}`).set(auth).expect(200)).body.title).toBe('On the train');
    expect((await request(server).get('/api/notes').set(auth).expect(200)).body.total).toBe(1);

    // Only a random UUID will do.
    await request(server).post('/api/notes').set(auth).send({ id: 'nope' }).expect(400);
    await request(server).post('/api/notes').set(auth).send({ id: 'a8098c1a-f86e-11da-bd1a-00112444be1e' }).expect(400);
  });
});

describe('templates and copies', () => {
  it('keeps a template out of the lists and makes notes from it with the placeholders filled in', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const post = async (path: string, body: object = {}, headers = auth) =>
      (await request(server).post(path).set(headers).send(body).expect(201)).body;
    const get = async (path: string) => (await request(server).get(path).set(auth).expect(200)).body;
    const ids = (items: { id: string }[]) => items.map((item) => item.id);

    const notebook = await post('/api/notebooks', { name: 'Work' });
    const target = await post('/api/notes', { title: 'Deep Work', content: 'A book.' });
    const template = await post('/api/notes', {
      title: 'Weekly review template',
      content: '# {{title}}\n\nWeek ending {{date}}, written at {{ time }}. {{mood}}\n\nInspired by [[Deep Work]].',
      notebookId: notebook.id,
      tags: ['review'],
      pinned: true,
    });
    await request(server).post(`/api/notes/${template.id}/share`).set(auth).expect(200);
    expect(ids(await get(`/api/notes/${target.id}/backlinks`))).toEqual([template.id]);

    // Making it a template is no edit: same revision, same "last edited".
    const marked = await request(server).patch(`/api/notes/${template.id}`).set(auth).send({ isTemplate: true });
    expect(marked.body).toMatchObject({ isTemplate: true, revision: 0, updatedAt: template.updatedAt });

    // Gone from everything that lists notes, through the one shared condition.
    expect(ids((await get('/api/notes')).items)).toEqual([target.id]);
    expect(ids((await get('/api/notes?pinned=true')).items)).toEqual([]);
    expect(ids((await get('/api/search?q=weekly')).items)).toEqual([]);
    expect(ids(await get('/api/notes/titles?q=Weekly'))).toEqual([]);
    expect(ids(await get('/api/notes/titles'))).toEqual([target.id]);
    expect(await get(`/api/notes/${target.id}/backlinks`)).toEqual([]);
    // The notebook counts it apart, so that deleting the notebook can say a template goes with it.
    expect(await get('/api/notebooks')).toMatchObject([{ noteCount: 0, templateCount: 1 }]);
    expect(await get('/api/tags')).toEqual([]);
    // It has a list of its own, is still a note by its id, and a link to its title still leads to it.
    expect(ids((await get('/api/notes?templates=true')).items)).toEqual([template.id]);
    expect((await get(`/api/notes/${template.id}`)).isTemplate).toBe(true);
    expect((await get('/api/notes/resolve?title=weekly%20review%20template')).id).toBe(template.id);

    // A note from the template: text and tags with the placeholders filled in, and nothing else of it.
    const made = await post('/api/notes', {
      templateId: template.id,
      title: 'Weekly review',
      placeholders: { date: '2026-11-20', time: '19:30' },
    });
    expect(made).toMatchObject({
      title: 'Weekly review',
      content: '# Weekly review\n\nWeek ending 2026-11-20, written at 19:30. {{mood}}\n\nInspired by [[Deep Work]].',
      tags: ['review'],
      isTemplate: false,
      pinned: false,
      shared: false,
      notebookId: null,
      revision: 0,
    });
    expect(await get(`/api/notes/${made.id}/versions`)).toEqual([]);
    // Its links are real links: the new note shows up as a backlink, the template still does not.
    expect(await get(`/api/notes/${made.id}/links`)).toEqual([{ title: 'Deep Work', noteId: target.id }]);
    expect(ids(await get(`/api/notes/${target.id}/backlinks`))).toEqual([made.id]);

    // Without values the placeholders stay as written: the server does not guess the day.
    // Nor the title: the note does not take the template's, it starts untitled.
    const unfilled = await post('/api/notes', { templateId: template.id });
    expect(unfilled.title).toBe('Untitled');
    expect(unfilled.content).toContain('Week ending {{date}}, written at {{ time }}.');
    expect(unfilled.content).toContain('# {{title}}\n');

    // Only a template of one's own can be used, and only the known placeholders are taken.
    const body = { templateId: template.id };
    await request(server).post('/api/notes').set(other.auth).send(body).expect(404);
    await request(server).post('/api/notes').set(auth).send({ templateId: target.id }).expect(404);
    await request(server).post('/api/notes').set(auth).send({ templateId: 'nope' }).expect(400);
    await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ ...body, placeholders: { author: 'me' } })
      .expect(400);
    await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ ...body, placeholders: { date: 'x\0' } })
      .expect(400);
    await request(server).delete(`/api/notes/${template.id}`).set(auth).expect(204);
    await request(server).post('/api/notes').set(auth).send(body).expect(404);
    expect(ids((await get('/api/notes?templates=true')).items)).toEqual([]);
  });

  it('leads a link to a note before a template of the same title, and renames links in templates too', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const post = async (body: object) =>
      (await request(server).post('/api/notes').set(auth).send(body).expect(201)).body;
    const resolve = async (title: string) =>
      (await request(server).get('/api/notes/resolve').query({ title }).set(auth).expect(200)).body.id;

    const meeting = await post({ title: 'Meeting notes', content: 'The real one.' });
    const template = await post({ title: 'Meeting notes', content: 'Agenda for [[Atlas]].', isTemplate: true });
    const linking = await post({ title: 'Monday', content: 'See [[Meeting notes]].' });
    // The template was edited last, and still the link leads to the note.
    await request(server).patch(`/api/notes/${template.id}`).set(auth).send({ content: 'Agenda for [[Atlas]]!' });
    expect(await resolve('meeting notes')).toBe(meeting.id);
    const links = await request(server).get(`/api/notes/${linking.id}/links`).set(auth).expect(200);
    expect(links.body).toEqual([{ title: 'Meeting notes', noteId: meeting.id }]);
    // With the note gone, the template is what the title leads to.
    await request(server).delete(`/api/notes/${meeting.id}`).set(auth).expect(204);
    expect(await resolve('Meeting notes')).toBe(template.id);

    // The notes made from a template later should not start with a link to an old title.
    const atlas = await post({ title: 'Atlas' });
    await request(server).patch(`/api/notes/${atlas.id}`).set(auth).send({ title: 'Project Atlas' }).expect(200);
    const renamed = await request(server)
      .post(`/api/notes/${atlas.id}/rename-links`)
      .set(auth)
      .send({ from: 'Atlas' })
      .expect(200);
    expect(renamed.body).toMatchObject({ updated: 1, noteIds: [template.id] });
    const after = await request(server).get(`/api/notes/${template.id}`).set(auth).expect(200);
    expect(after.body).toMatchObject({ content: 'Agenda for [[Project Atlas]]!', isTemplate: true });
  });

  it('duplicates a note with its text, tags and notebook, and leaves the rest behind', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const post = async (path: string, body: object = {}) =>
      (await request(server).post(path).set(auth).send(body).expect(201)).body;

    const notebook = await post('/api/notebooks', { name: 'Work' });
    const original = await post('/api/notes', {
      title: 'Plan',
      content: 'Due {{date}}, see [[Atlas]].',
      notebookId: notebook.id,
      tags: ['q1', 'work'],
      pinned: true,
      favorite: true,
    });
    await request(server)
      .patch(`/api/notes/${original.id}`)
      .set(auth)
      .send({ content: 'Due {{date}}, see [[Atlas]]!' });
    await request(server).post(`/api/notes/${original.id}/share`).set(auth).expect(200);

    const copy = await post(`/api/notes/${original.id}/duplicate`);
    expect(copy).toMatchObject({
      title: 'Plan (copy)',
      content: 'Due {{date}}, see [[Atlas]]!',
      notebookId: notebook.id,
      tags: ['q1', 'work'],
      pinned: false,
      favorite: false,
      shared: false,
      isTemplate: false,
      revision: 0,
    });
    expect(copy.id).not.toBe(original.id);
    const versions = await request(server).get(`/api/notes/${copy.id}/versions`).set(auth).expect(200);
    expect(versions.body).toEqual([]);
    const links = await request(server).get(`/api/notes/${copy.id}/links`).set(auth).expect(200);
    expect(links.body).toEqual([{ title: 'Atlas', noteId: null }]);

    // A copy of a template is a template.
    await request(server).patch(`/api/notes/${original.id}`).set(auth).send({ isTemplate: true }).expect(200);
    expect((await post(`/api/notes/${original.id}/duplicate`)).isTemplate).toBe(true);

    await request(server).post(`/api/notes/${original.id}/duplicate`).set(other.auth).expect(404);
    await request(server).delete(`/api/notes/${original.id}`).set(auth).expect(204);
    await request(server).post(`/api/notes/${original.id}/duplicate`).set(auth).expect(409);
  });
});

describe('daily notes', () => {
  it('opens one note per day, made the way the preferences say, however often and however it is asked for', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const post = async (path: string, body: object = {}) =>
      (await request(server).post(path).set(auth).send(body).expect(201)).body;
    const daily = (body: object, headers = auth) => request(server).post('/api/notes/daily').set(headers).send(body);
    const today = { date: '2026-11-20', placeholders: { date: '2026-11-20', time: '08:15' } };

    // Nothing chosen yet: the defaults come with the account.
    const me = await request(server).get('/api/auth/me').set(auth).expect(200);
    expect(me.body.preferences).toEqual({ dailyNotes: { notebookId: null, templateId: null, dateFormat: 'iso' } });

    const journal = await post('/api/notebooks', { name: 'Journal' });
    const template = await post('/api/notes', {
      title: 'Daily template',
      content: '# {{title}}\n\nStarted at {{time}}.\n\n- [ ] Plan the day',
      tags: ['journal'],
      isTemplate: true,
    });
    const saved = await request(server)
      .patch('/api/auth/preferences')
      .set(auth)
      .send({ dailyNotes: { notebookId: journal.id, templateId: template.id, dateFormat: 'long' } })
      .expect(200);
    expect(saved.body.dailyNotes).toEqual({ notebookId: journal.id, templateId: template.id, dateFormat: 'long' });
    // Only what is sent changes, and the choices come back with the account on any device.
    await request(server)
      .patch('/api/auth/preferences')
      .set(auth)
      .send({ dailyNotes: { dateFormat: 'us' } })
      .expect(200);
    await request(server)
      .patch('/api/auth/preferences')
      .set(auth)
      .send({ dailyNotes: { dateFormat: 'long' } })
      .expect(200);
    const again = await request(server).get('/api/auth/me').set(auth).expect(200);
    expect(again.body.preferences.dailyNotes).toEqual(saved.body.dailyNotes);

    // Several tabs ask for today's note at once. There is one note, and they all get it.
    const answers = await Promise.all(Array.from({ length: 6 }, () => daily(today)));
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 200, 200, 200]);
    const [note] = answers.map((answer) => answer.body);
    expect(new Set(answers.map((answer) => answer.body.id)).size).toBe(1);
    expect(note).toMatchObject({
      title: '20 November 2026',
      content: '# 20 November 2026\n\nStarted at 08:15.\n\n- [ ] Plan the day',
      notebookId: journal.id,
      tags: ['journal'],
      isTemplate: false,
      revision: 0,
    });
    const list = await request(server).get('/api/notes').set(auth).expect(200);
    expect(list.body.items.map((item: { id: string }) => item.id)).toEqual([note.id]);

    // Still the same note after it was written in, renamed, and the format was changed.
    await request(server)
      .patch(`/api/notes/${note.id}`)
      .set(auth)
      .send({ title: 'A long Friday', revision: 0 })
      .expect(200);
    await request(server)
      .patch('/api/auth/preferences')
      .set(auth)
      .send({ dailyNotes: { dateFormat: 'iso' } })
      .expect(200);
    const later = await daily({ date: '2026-11-20' }).expect(200);
    expect(later.body).toMatchObject({ id: note.id, title: 'A long Friday', revision: 1 });

    // Another day is another note. One that was written by hand under that day's title is taken for it.
    const byHand = await post('/api/notes', { title: 'november 21, 2026', content: 'Written the evening before.' });
    const tomorrow = await daily({ date: '2026-11-21' }).expect(200);
    expect(tomorrow.body).toMatchObject({ id: byHand.id, content: 'Written the evening before.', revision: 0 });
    expect(tomorrow.body.updatedAt).toBe(byHand.updatedAt);

    // In the trash, the note of a day makes room for a new one and stays what it was.
    await request(server).delete(`/api/notes/${note.id}`).set(auth).expect(204);
    const fresh = await daily({ date: '2026-11-20' }).expect(200);
    expect(fresh.body.id).not.toBe(note.id);
    expect(fresh.body.title).toBe('2026-11-20');
    await request(server).post(`/api/trash/${note.id}/restore`).set(auth).expect(204);
    expect((await daily({ date: '2026-11-20' }).expect(200)).body.id).toBe(fresh.body.id);

    // A copy of a daily note is an ordinary note, and each account has its own days.
    await post(`/api/notes/${fresh.body.id}/duplicate`);
    expect((await daily({ date: '2026-11-20' }).expect(200)).body.id).toBe(fresh.body.id);
    const theirs = await daily({ date: '2026-11-20' }, other.auth).expect(200);
    expect(theirs.body.id).not.toBe(fresh.body.id);
    expect(theirs.body).toMatchObject({ content: '', notebookId: null, tags: [] });

    // The title is written in the format stored now, also for a tab that read another one earlier.
    await request(server)
      .patch('/api/auth/preferences')
      .set(auth)
      .send({ dailyNotes: { dateFormat: 'us' } })
      .expect(200);
    expect((await daily({ date: '2026-11-23' }).expect(200)).body.title).toBe('November 23, 2026');

    // A template or a notebook that is gone is no longer used, and nothing fails over it.
    await request(server).delete(`/api/notes/${template.id}`).set(auth).expect(204);
    await request(server).delete(`/api/notebooks/${journal.id}`).set(auth).expect(200);
    const plain = await daily({ date: '2026-11-22' }).expect(200);
    expect(plain.body).toMatchObject({ content: '', notebookId: null, tags: [] });
  });

  it('lets a note go from its day, after which neither the day nor its title leads back to it', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const daily = (date: string) => request(server).post('/api/notes/daily').set(auth).send({ date }).expect(200);

    // Unrelated, but titled with a day: it is taken for that day.
    const unrelated = await request(server).post('/api/notes').set(auth).send({ title: '2026-11-21', content: 'Mine' });
    const adopted = await daily('2026-11-21');
    expect(adopted.body).toMatchObject({ id: unrelated.body.id, dailyDate: '2026-11-21' });

    await request(server).delete(`/api/notes/${unrelated.body.id}/daily`).set(other.auth).expect(404);
    const released = await request(server).delete(`/api/notes/${unrelated.body.id}/daily`).set(auth).expect(200);
    expect(released.body).toMatchObject({ title: '2026-11-21', content: 'Mine', dailyDate: null, revision: 0 });
    expect(released.body.updatedAt).toBe(unrelated.body.updatedAt);

    // The next "Today" makes a note of its own, and keeps it.
    const fresh = await daily('2026-11-21');
    expect(fresh.body.id).not.toBe(unrelated.body.id);
    expect(fresh.body.dailyDate).toBe('2026-11-21');
    expect((await daily('2026-11-21')).body.id).toBe(fresh.body.id);
    // Released, the old note is not taken for that day again, not even when the new one goes.
    await request(server).delete(`/api/notes/${fresh.body.id}`).set(auth).expect(204);
    expect((await daily('2026-11-21')).body.id).not.toBe(unrelated.body.id);
  });

  it('takes only real days, no title, and preferences that are the user’s own', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const daily = (body: object) => request(server).post('/api/notes/daily').set(auth).send(body);

    await daily({ date: '2026-02-30' }).expect(400);
    await daily({ date: '20 November 2026' }).expect(400);
    await daily({}).expect(400);
    // The title is the server's to write, from the format the account has now.
    await daily({ date: '2026-11-20', title: '2026-11-20' }).expect(400);
    await daily({ date: '2026-11-20', notebookId: 'x' }).expect(400);
    await request(server).post('/api/notes/daily').send({ date: '2026-11-20' }).expect(401);

    const preferences = (body: object) => request(server).patch('/api/auth/preferences').set(auth).send(body);
    const theirNotebook = await request(server).post('/api/notebooks').set(other.auth).send({ name: 'Theirs' });
    const ordinary = await request(server).post('/api/notes').set(auth).send({ title: 'No template' });
    await preferences({ dailyNotes: { notebookId: theirNotebook.body.id } }).expect(400);
    await preferences({ dailyNotes: { templateId: ordinary.body.id } }).expect(400);
    await preferences({ dailyNotes: { dateFormat: 'roman' } }).expect(400);
    // There is always a format, and always a set of daily note choices: null is no value for either.
    await preferences({ dailyNotes: { dateFormat: null } }).expect(400);
    await preferences({ dailyNotes: null }).expect(400);
    await preferences({ dailyNotes: { notebookId: 'not-an-id' } }).expect(400);
    await preferences({ theme: 'dark' }).expect(400);
    const untouched = await request(server).get('/api/auth/me').set(auth).expect(200);
    expect(untouched.body.preferences).toEqual({
      dailyNotes: { notebookId: null, templateId: null, dateFormat: 'iso' },
    });
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

  const shareOf = async (auth: { Authorization: string }, title = 'Recipe') => {
    const server = app.getHttpServer();
    const note = await request(server).post('/api/notes').set(auth).send({ title, content: 'Bread' }).expect(201);
    const share = await request(server).post(`/api/notes/${note.body.id}/share`).set(auth).expect(200);
    return {
      noteId: note.body.id as string,
      token: share.body.token as string,
      path: `/api/notes/${note.body.id}/share`,
    };
  };

  it('asks readers for the password, which travels in the body, and never tells anyone to keep a copy', async () => {
    const server = app.getHttpServer();
    const { auth } = await signUp();
    const { token, path } = await shareOf(auth);

    await request(server).patch(path).set(auth).send({ password: 'short' }).expect(400);
    const set = await request(server).patch(path).set(auth).send({ password: 'open sesame' }).expect(200);
    expect(set.body).toMatchObject({ token, hasPassword: true, expiresAt: null, expired: false });
    expect(JSON.stringify(set.body)).not.toContain('open sesame');
    expect(set.body).not.toHaveProperty('passwordHash');

    // Enough to show a prompt, and nothing of the note.
    const prompt = await request(server).get(`/api/public/notes/${token}`).expect(403);
    expect(prompt.body).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'This link is protected by a password',
      passwordRequired: true,
    });
    expect(prompt.headers['cache-control']).toBe('no-store');
    // A password in the address is not looked at.
    await request(server).get(`/api/public/notes/${token}?password=open%20sesame`).expect(403);

    const wrong = await request(server)
      .post(`/api/public/notes/${token}`)
      .send({ password: 'open says me' })
      .expect(403);
    expect(wrong.body).toMatchObject({ passwordRequired: true, message: 'That password is not right' });
    expect(wrong.headers['cache-control']).toBe('no-store');
    const empty = await request(server).post(`/api/public/notes/${token}`).send({}).expect(400);
    expect(empty.headers['cache-control']).toBe('no-store');

    const opened = await request(server)
      .post(`/api/public/notes/${token}`)
      .send({ password: 'open sesame' })
      .expect(200);
    expect(opened.body).toMatchObject({ title: 'Recipe', content: 'Bread' });
    expect(opened.headers['cache-control']).toBe('no-store');

    // Taking the password away opens the same link again.
    await request(server).patch(path).set(auth).send({ password: null }).expect(200);
    const open = await request(server).get(`/api/public/notes/${token}`).expect(200);
    expect(open.headers['cache-control']).toBe('no-store');
  });

  it('stops working when it runs out, and then looks like a link that never was', async () => {
    const server = app.getHttpServer();
    const prisma = app.get(PrismaService);
    const { auth } = await signUp();
    const { noteId, token, path } = await shareOf(auth);
    const soon = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await request(server).patch(path).set(auth).send({ expiresAt: 'next week' }).expect(400);
    await request(server).patch(path).set(auth).send({ expiresAt: '2020-01-01T00:00:00Z' }).expect(400);
    // Forms that pass for ISO 8601 and that no date can be made of, or only with a guess at the zone.
    for (const unreadable of ['2027-W01', '20270101', '2099-01-01T10:00']) {
      const refused = await request(server).patch(path).set(auth).send({ expiresAt: unreadable }).expect(400);
      expect(refused.body.message).toEqual(['expiresAt must be a date and time such as 2026-03-01T12:00:00Z']);
    }
    const limited = await request(server)
      .patch(path)
      .set(auth)
      .send({ expiresAt: soon, password: 'open sesame' })
      .expect(200);
    expect(limited.body).toMatchObject({ expiresAt: soon, expired: false, hasPassword: true });
    await request(server).get(`/api/public/notes/${token}`).expect(403);

    // The hour passes.
    await prisma.shareLink.update({ where: { noteId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const never = await request(server).get('/api/public/notes/there-is-no-such-link').expect(404);
    const expired = await request(server).get(`/api/public/notes/${token}`).expect(404);
    const expiredWithPassword = await request(server)
      .post(`/api/public/notes/${token}`)
      .send({ password: 'open sesame' })
      .expect(404);
    const expiredWithGuess = await request(server)
      .post(`/api/public/notes/${token}`)
      .send({ password: 'guess' })
      .expect(404);
    // Not even that it once had a password shows.
    expect(expired.body).toEqual(never.body);
    expect(expiredWithPassword.body).toEqual(never.body);
    expect(expiredWithGuess.body).toEqual(never.body);
    expect(expired.headers['cache-control']).toBe('no-store');

    // The owner sees what happened, and can give it more time.
    const seen = await request(server).get(path).set(auth).expect(200);
    expect(seen.body.share).toMatchObject({ token, expired: true, hasPassword: true });
    await request(server).patch(path).set(auth).send({ expiresAt: null }).expect(200);
    await request(server).post(`/api/public/notes/${token}`).send({ password: 'open sesame' }).expect(200);
  });

  it('counts the views of others, not the owner looking at their own note', async () => {
    const server = app.getHttpServer();
    const { auth } = await signUp();
    const stranger = await signUp();
    const { token, path } = await shareOf(auth);
    const views = async () => (await request(server).get(path).set(auth).expect(200)).body.share.viewCount as number;

    await request(server).get(`/api/public/notes/${token}`).set(auth).expect(200);
    expect(await views()).toBe(0);

    await request(server).get(`/api/public/notes/${token}`).expect(200);
    await request(server).get(`/api/public/notes/${token}`).set(stranger.auth).expect(200);
    await request(server).get(`/api/public/notes/${token}`).set({ Authorization: 'Bearer not-a-token' }).expect(200);
    expect(await views()).toBe(3);

    // Behind a password too, and a refused attempt is not a view.
    await request(server).patch(path).set(auth).send({ password: 'open sesame' }).expect(200);
    await request(server).get(`/api/public/notes/${token}`).expect(403);
    await request(server).post(`/api/public/notes/${token}`).send({ password: 'wrong one' }).expect(403);
    await request(server).post(`/api/public/notes/${token}`).set(auth).send({ password: 'open sesame' }).expect(200);
    expect(await views()).toBe(3);
    await request(server).post(`/api/public/notes/${token}`).send({ password: 'open sesame' }).expect(200);
    expect(await views()).toBe(4);
  });
});

describe('notebooks shared with other accounts', () => {
  type Auth = { Authorization: string };
  const server = () => app.getHttpServer();
  async function account(): Promise<{ auth: Auth; email: string; id: string }> {
    const email = `share-${Date.now()}-${++counter}@example.com`;
    const response = await request(server())
      .post('/api/auth/register')
      .send({ email, name: `Name ${counter}`, password: 'password123' })
      .expect(201);
    return { auth: { Authorization: `Bearer ${response.body.token}` }, email, id: response.body.user.id };
  }
  const post = async (auth: Auth, path: string, body: object = {}) =>
    (await request(server()).post(path).set(auth).send(body).expect(201)).body;

  /** An owner with a notebook "Kitchen" (and "Bread" inside it), a private note, and a member who joined by the mailed link. */
  async function kitchen(role: 'read' | 'edit') {
    const owner = await account();
    const member = await account();
    const kitchenBook = await post(owner.auth, '/api/notebooks', { name: 'Kitchen' });
    const bread = await post(owner.auth, '/api/notebooks', { name: 'Bread', parentId: kitchenBook.id });
    const other = await post(owner.auth, '/api/notebooks', { name: 'Diary' });
    const soup = await post(owner.auth, '/api/notes', {
      title: 'Soup',
      content: 'Goes with [[Rye]], see [[Private plan]].',
      notebookId: kitchenBook.id,
      tags: ['food'],
    });
    const rye = await post(owner.auth, '/api/notes', { title: 'Rye', content: 'With [[Soup]].', notebookId: bread.id });
    const plan = await post(owner.auth, '/api/notes', { title: 'Private plan', content: 'Mentions [[Soup]].' });
    const diary = await post(owner.auth, '/api/notes', {
      title: 'Diary entry',
      content: 'Dear diary',
      notebookId: other.id,
    });
    await request(server())
      .post(`/api/notebooks/${kitchenBook.id}/members/invites`)
      .set(owner.auth)
      .send({ email: member.email.toUpperCase(), role })
      .expect(201);
    const mail = await mailTo(member.email);
    const token = /#token=([\w-]+)/.exec(mail.text)?.[1] ?? '';
    // Nothing in the mail comes from the owner: not the name of the notebook, not the owner's name.
    expect(mail.text).not.toContain('Kitchen');
    await request(server()).post('/api/invites/accept').set(member.auth).send({ token }).expect(200);
    return { owner, member, kitchen: kitchenBook.id, bread: bread.id, other: other.id, soup, rye, plan, diary, token };
  }

  it('answers every note route with 404 to an account that is not a member', async () => {
    const { owner, soup, plan, member } = await kitchen('read');
    const outsider = await account();
    await request(server()).patch(`/api/notes/${soup.id}`).set(owner.auth).send({ content: 'Leeks.' }).expect(200);
    const [version] = (await request(server()).get(`/api/notes/${soup.id}/versions`).set(owner.auth).expect(200)).body;
    const bodies: Record<string, object> = {
      'NotesController.update': { title: 'Taken' },
      'NotesController.renameLinks': { from: 'Old' },
    };
    const routes = registeredRoutes(app).filter(
      (route) =>
        (route.name.startsWith('NotesController.') && route.documented.includes('{id}')) ||
        route.documented.startsWith('/api/notes/{noteId}'),
    );
    expect(routes.length).toBeGreaterThan(15);
    const walk = async (auth: Auth, noteId: string) => {
      for (const route of routes) {
        const path = route.documented
          .replace('{id}', noteId)
          .replace('{noteId}', noteId)
          .replace('{versionId}', version.id);
        const query = route.name === 'NotesController.orphanedLinks' ? '?from=Old' : '';
        const response = await request(server())
          [route.verb](path + query)
          .set(auth)
          .send(bodies[route.name] ?? {});
        expect({ route: route.name, status: response.status }).toEqual({ route: route.name, status: 404 });
      }
    };
    await walk(outsider.auth, soup.id);
    // A member is an outsider to the owner's notes outside the shared notebook.
    await walk(member.auth, plan.id);
  });

  it('lets a reader read the shared notebook, and nothing else of the owner', async () => {
    const { owner, member, kitchen: book, bread, soup, rye, plan, diary } = await kitchen('read');
    const get = async (path: string, auth = member.auth) =>
      (await request(server()).get(path).set(auth).expect(200)).body;

    const notebooks = await get('/api/notebooks');
    expect(notebooks.map((n: { name: string; access: string; owner: unknown }) => [n.name, n.access, n.owner])).toEqual(
      expect.arrayContaining([
        ['Kitchen', 'read', { name: expect.any(String) }],
        ['Bread', 'read', { name: expect.any(String) }],
      ]),
    );
    expect(notebooks.map((n: { name: string }) => n.name)).not.toContain('Diary');

    expect(await get(`/api/notes/${soup.id}`)).toMatchObject({ title: 'Soup', access: 'read' });
    expect((await get(`/api/notes?notebookId=${book}`)).items.map((n: { title: string }) => n.title).sort()).toEqual([
      'Rye',
      'Soup',
    ]);
    // Their own lists stay their own.
    expect((await get('/api/notes')).items).toEqual([]);
    // Links lead only to what they may read: the private plan reads as missing.
    expect(await get(`/api/notes/${soup.id}/links`)).toEqual([
      { title: 'Rye', noteId: rye.id },
      { title: 'Private plan', noteId: null },
    ]);
    expect((await get(`/api/notes/${soup.id}/backlinks`)).map((b: { id: string }) => b.id)).toEqual([rye.id]);
    expect((await get(`/api/notes/titles?notebookId=${book}`)).map((n: { title: string }) => n.title).sort()).toEqual([
      'Rye',
      'Soup',
    ]);
    await request(server())
      .get(`/api/notes/resolve?title=Private%20plan&notebookId=${book}`)
      .set(member.auth)
      .expect(404);
    expect((await get(`/api/notes/resolve?title=rye&notebookId=${book}`)).id).toBe(rye.id);
    expect((await get(`/api/search?q=diary`)).items).toEqual([]);
    expect((await get(`/api/search?q=soup&notebookId=${book}`)).items.map((h: { id: string }) => h.id)).toContain(
      soup.id,
    );
    expect((await get(`/api/search?q=diary&notebookId=${book}`)).items).toEqual([]);
    await request(server()).get(`/api/notes?notebookId=${bread}`).set(member.auth).expect(200);
    expect(await get('/api/tags')).toEqual([]);

    // Reading is all: no change, no new note, nothing of the owner's own.
    await request(server()).patch(`/api/notes/${soup.id}`).set(member.auth).send({ content: 'x' }).expect(403);
    await request(server()).post('/api/notes').set(member.auth).send({ title: 'x', notebookId: book }).expect(403);
    await request(server()).delete(`/api/notes/${soup.id}`).set(member.auth).expect(403);
    await request(server()).get(`/api/notes/${diary.id}`).set(member.auth).expect(404);
    await request(server()).get(`/api/notes/${plan.id}`).set(member.auth).expect(404);
    await request(server()).patch(`/api/notebooks/${book}`).set(member.auth).send({ name: 'Mine now' }).expect(404);
    await request(server()).get(`/api/notebooks/${book}/share`).set(member.auth).expect(404);
    // The owner sees who is in.
    const members = await get(`/api/notebooks/${book}/members`, owner.auth);
    expect(members.members).toMatchObject([{ email: member.email, role: 'read' }]);
  });

  it('lets an editor change text and tags as the owner’s, with the usual conflicts, and add notes', async () => {
    const { owner, member, kitchen: book, soup } = await kitchen('edit');
    const patch = (auth: Auth, body: object) => request(server()).patch(`/api/notes/${soup.id}`).set(auth).send(body);

    const saved = await patch(member.auth, {
      content: 'Leeks and potatoes.',
      revision: 0,
      tags: ['food', 'winter'],
    }).expect(200);
    expect(saved.body).toMatchObject({ access: 'edit', revision: 1, tags: ['food', 'winter'] });
    // Tags are the owner's: they show in the owner's list, not the member's.
    expect(
      (await request(server()).get('/api/tags').set(owner.auth)).body.map((t: { name: string }) => t.name),
    ).toContain('winter');
    expect((await request(server()).get('/api/tags').set(member.auth)).body).toEqual([]);
    // Two editors, one revision: the second is refused with the note as it is.
    await patch(owner.auth, { content: 'Owner text', revision: 1 }).expect(200);
    const stale = await patch(member.auth, { content: 'Member text', revision: 1 }).expect(409);
    expect(stale.body).toMatchObject({ code: 'stale_revision', note: { content: 'Owner text' } });
    // Pins, stars, moves and the template flag stay the owner's.
    await patch(member.auth, { pinned: true }).expect(403);
    await patch(member.auth, { notebookId: null }).expect(403);
    await patch(member.auth, { isTemplate: true }).expect(403);
    // A new note in the shared notebook is the owner's.
    const made = await post(member.auth, '/api/notes', { title: 'Stew', notebookId: book });
    expect(made).toMatchObject({ access: 'edit', notebookId: book });
    const ownList = await request(server()).get(`/api/notes?notebookId=${book}`).set(owner.auth).expect(200);
    expect(ownList.body.items.map((n: { id: string }) => n.id)).toContain(made.id);
    await request(server()).post(`/api/notes/${soup.id}/versions/x/restore`).set(member.auth).expect(400);
  });

  it('keeps templates and the trash out of reach, and ends access on removal and on leaving', async () => {
    const { owner, member, kitchen: book, soup } = await kitchen('edit');
    const template = await post(owner.auth, '/api/notes', { title: 'Recipe card', notebookId: book, isTemplate: true });
    await request(server()).get(`/api/notes/${template.id}`).set(member.auth).expect(404);
    const listed = await request(server())
      .get(`/api/notes?notebookId=${book}&templates=true`)
      .set(member.auth)
      .expect(200);
    expect(listed.body.items.map((n: { id: string }) => n.id)).not.toContain(template.id);

    await request(server()).delete(`/api/notes/${soup.id}`).set(owner.auth).expect(204);
    await request(server()).get(`/api/notes/${soup.id}`).set(member.auth).expect(404);
    // A change waiting in a member's outbox for a note they lost is refused like any other.
    await request(server())
      .patch(`/api/notes/${soup.id}`)
      .set(member.auth)
      .send({ content: 'x', revision: 0 })
      .expect(404);

    const rye = (await request(server()).get(`/api/notes?notebookId=${book}`).set(member.auth).expect(200)).body
      .items[0];
    await request(server()).delete(`/api/notebooks/${book}/members/${member.id}`).set(owner.auth).expect(204);
    await request(server()).get(`/api/notes/${rye.id}`).set(member.auth).expect(404);
    expect((await request(server()).get('/api/notebooks').set(member.auth)).body).toEqual([]);

    // Invited again, accepted in the app this time, then left.
    await request(server())
      .post(`/api/notebooks/${book}/members/invites`)
      .set(owner.auth)
      .send({ email: member.email, role: 'read' })
      .expect(201);
    const [invite] = (await request(server()).get('/api/invites').set(member.auth).expect(200)).body;
    expect(invite).toMatchObject({ notebook: { id: book, name: 'Kitchen' }, role: 'read' });
    await request(server()).post(`/api/invites/${invite.id}/accept`).set(member.auth).expect(200);
    await request(server()).get(`/api/notes/${rye.id}`).set(member.auth).expect(200);
    await request(server()).delete(`/api/notebooks/${book}/members/${member.id}`).set(member.auth).expect(204);
    await request(server()).get(`/api/notes/${rye.id}`).set(member.auth).expect(404);
  });

  it('takes an invitation only from the invited address, once, and only while it is open', async () => {
    const owner = await account();
    const invited = await account();
    const stranger = await account();
    const book = await post(owner.auth, '/api/notebooks', { name: 'Secrets' });
    const invites = `/api/notebooks/${book.id}/members/invites`;
    await request(server()).post(invites).set(owner.auth).send({ email: owner.email, role: 'read' }).expect(400);
    await request(server()).post(invites).set(stranger.auth).send({ email: invited.email, role: 'read' }).expect(404);
    await request(server()).post(invites).set(owner.auth).send({ email: invited.email, role: 'own' }).expect(400);
    await request(server()).post(invites).set(owner.auth).send({ email: invited.email, role: 'edit' }).expect(201);
    const token = /#token=([\w-]+)/.exec((await mailTo(invited.email)).text)?.[1] ?? '';

    // Forwarded to someone else, the link is no use to them.
    await request(server()).post('/api/invites/accept').set(stranger.auth).send({ token }).expect(403);
    const [received] = (await request(server()).get('/api/invites').set(invited.auth)).body;
    await request(server()).post(`/api/invites/${received.id}/accept`).set(stranger.auth).expect(403);
    expect((await request(server()).get('/api/invites').set(stranger.auth)).body).toEqual([]);

    await request(server()).post('/api/invites/accept').set(invited.auth).send({ token }).expect(200);
    await request(server()).post('/api/invites/accept').set(invited.auth).send({ token }).expect(404);
    await request(server()).post(invites).set(owner.auth).send({ email: invited.email, role: 'read' }).expect(409);

    // Run out: an invitation a week old works no more.
    const late = await account();
    await request(server()).post(invites).set(owner.auth).send({ email: late.email, role: 'read' }).expect(201);
    const lateToken = /#token=([\w-]+)/.exec((await mailTo(late.email)).text)?.[1] ?? '';
    await app
      .get(PrismaService)
      .notebookInvite.updateMany({ where: { email: late.email }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(server()).post('/api/invites/accept').set(late.auth).send({ token: lateToken }).expect(404);
    expect((await request(server()).get('/api/invites').set(late.auth)).body).toEqual([]);

    // Declined, it is gone.
    const other = await account();
    await request(server()).post(invites).set(owner.auth).send({ email: other.email, role: 'read' }).expect(201);
    const [offer] = (await request(server()).get('/api/invites').set(other.auth)).body;
    await request(server()).delete(`/api/invites/${offer.id}`).set(other.auth).expect(204);
    expect((await request(server()).get('/api/invites').set(other.auth)).body).toEqual([]);
  });
});

describe('sharing a notebook', () => {
  /** Recipes with Soup in it, Bread inside Recipes with Rye in it, and a note in no notebook. */
  const kitchen = async () => {
    const server = app.getHttpServer();
    const { auth } = await signUp();
    const make = async (path: string, body: object) =>
      (await request(server).post(path).set(auth).send(body).expect(201)).body;
    const recipes = await make('/api/notebooks', { name: 'Recipes' });
    const bread = await make('/api/notebooks', { name: 'Bread', parentId: recipes.id });
    const soup = await make('/api/notes', { title: 'Soup', content: 'Leeks.', notebookId: recipes.id });
    const plan = await make('/api/notes', { title: 'Private plan', content: 'Nobody reads this.' });
    const rye = await make('/api/notes', {
      title: 'Rye',
      content: 'Goes with [[soup]]. See [[Private plan|the plan]], [[Private plan]] and [[Missing note]].',
      notebookId: bread.id,
    });
    const share = await request(server).post(`/api/notebooks/${recipes.id}/share`).set(auth).expect(200);
    return {
      server,
      auth,
      recipes: recipes.id as string,
      bread: bread.id as string,
      soup: soup.id as string,
      rye: rye.id as string,
      plan: plan.id as string,
      sharePath: `/api/notebooks/${recipes.id}/share`,
      link: `/api/public/notes/${share.body.token as string}`,
      token: share.body.token as string,
    };
  };

  it('shows its readers no template that sits in the notebook', async () => {
    const { server, auth, recipes, soup, link } = await kitchen();
    const template = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Recipe template', content: 'Serves {{title}}', notebookId: recipes, isTemplate: true })
      .expect(201);
    // A note in the notebook links to it by title.
    await request(server)
      .patch(`/api/notes/${soup}`)
      .set(auth)
      .send({ content: 'Leeks, see [[Recipe template]].' })
      .expect(200);

    const index = await request(server).get(link).expect(200);
    expect(JSON.stringify(index.body)).not.toContain('Recipe template');
    const never = await request(server).get(`${link}/6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e`).expect(404);
    const hidden = await request(server).get(`${link}/${template.body.id}`).expect(404);
    expect(hidden.body).toEqual(never.body);
    // The link reads as plain words, as one to a note the reader may not open.
    const shared = await request(server).get(`${link}/${soup}`).expect(200);
    expect(shared.body.links).toEqual({});
    expect(shared.body.content).not.toContain(template.body.id);
    // And the owner is not told that the template is public.
    const own = await request(server).get(`/api/notes/${template.body.id}`).set(auth).expect(200);
    expect(own.body.sharedThrough).toBeNull();
  });

  it('shows the notes of the notebook and of the notebooks inside it, and nothing from outside', async () => {
    const { server, auth, recipes, soup, rye, plan, link, token } = await kitchen();

    const index = await request(server).get(link).expect(200);
    expect(index.headers['cache-control']).toBe('no-store');
    expect(index.body).toMatchObject({ kind: 'notebook', name: 'Recipes' });
    expect(
      index.body.notes.map((note: { id: string; title: string; notebook: string | null }) => [
        note.title,
        note.notebook,
        note.id,
      ]),
    ).toEqual([
      ['Soup', null, soup],
      ['Rye', 'Bread', rye],
    ]);
    expect(JSON.stringify(index.body)).not.toContain('Private plan');

    const never = await request(server).get(`${link}/6f1d1c1e-8f7e-4a43-9a43-1f2a3b4c5d6e`).expect(404);
    const outside = await request(server).get(`${link}/${plan}`).expect(404);
    expect(outside.body).toEqual(never.body);

    // A note added to the notebook later is covered without touching the link.
    const pizza = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Pizza', notebookId: recipes })
      .expect(201);
    await request(server).get(`${link}/${pizza.body.id}`).expect(200);
    expect((await request(server).get(link).expect(200)).body.notes).toHaveLength(3);

    // The same link again, and the owner sees one link per notebook.
    const again = await request(server).post(`/api/notebooks/${recipes}/share`).set(auth).expect(200);
    expect(again.body.token).toBe(token);
  });

  it('follows [[links]] inside the notebook and gives away no title from outside it', async () => {
    const { server, soup, rye, link, token } = await kitchen();

    const shared = await request(server).get(`${link}/${rye}`).expect(200);

    expect(shared.body).toMatchObject({
      kind: 'note',
      title: 'Rye',
      // The link into the notebook stays. The private note is down to the words the page shows, the
      // note that does not exist looks no different, and the title behind the alias is gone.
      content: 'Goes with [[soup]]. See the plan, Private plan and Missing note.',
      links: { soup: `/s/${token}/${soup}` },
    });
    expect(Object.keys(shared.body.links)).toEqual(['soup']);
    expect(shared.body.content.match(/Private plan/g)).toHaveLength(1);
  });

  it('looks up titles among the shared notes, so a newer private note of the same title changes nothing', async () => {
    const { server, auth, soup, rye, link, token } = await kitchen();
    const before = await request(server).get(`${link}/${rye}`).expect(200);

    // In the app [[soup]] now leads to this one, the newest. Readers must not see a difference.
    await request(server).post('/api/notes').set(auth).send({ title: 'Soup', content: 'Private.' }).expect(201);

    const after = await request(server).get(`${link}/${rye}`).expect(200);
    expect(after.body).toEqual(before.body);
    expect(after.body.links).toEqual({ soup: `/s/${token}/${soup}` });
  });

  it('tells the owner what is public through a shared notebook, and through which', async () => {
    const { server, auth, recipes, bread, soup, rye, plan } = await kitchen();
    const through = { id: recipes, name: 'Recipes' };

    for (const id of [soup, rye]) {
      expect((await request(server).get(`/api/notes/${id}`).set(auth).expect(200)).body).toMatchObject({
        shared: false,
        sharedThrough: through,
      });
    }
    expect((await request(server).get(`/api/notes/${plan}`).set(auth).expect(200)).body.sharedThrough).toBeNull();
    const notebooks = (await request(server).get('/api/notebooks').set(auth).expect(200)).body as {
      id: string;
      shared: boolean;
      sharedThrough: object | null;
    }[];
    expect(notebooks.find((notebook) => notebook.id === recipes)).toMatchObject({
      shared: true,
      sharedThrough: through,
    });
    expect(notebooks.find((notebook) => notebook.id === bread)).toMatchObject({
      shared: false,
      sharedThrough: through,
    });

    // Moved in, the private note is public too, and says so.
    const moved = await request(server).patch(`/api/notes/${plan}`).set(auth).send({ notebookId: bread }).expect(200);
    expect(moved.body.sharedThrough).toEqual(through);
  });

  it('stops serving a note the moment it is moved out or put in the trash', async () => {
    const { server, auth, soup, rye, link } = await kitchen();
    const never = await request(server).get('/api/public/notes/there-is-no-such-link').expect(404);
    await request(server).get(`${link}/${soup}`).expect(200);

    await request(server).patch(`/api/notes/${soup}`).set(auth).send({ notebookId: null }).expect(200);
    const moved = await request(server).get(`${link}/${soup}`).expect(404);
    expect(moved.body).toEqual(never.body);
    // And the note that linked to it has a plain word where the link was.
    const rest = await request(server).get(`${link}/${rye}`).expect(200);
    expect(rest.body).toMatchObject({ content: expect.stringContaining('Goes with soup.'), links: {} });

    await request(server).delete(`/api/notes/${rye}`).set(auth).expect(204);
    await request(server).get(`${link}/${rye}`).expect(404);
    expect((await request(server).get(link).expect(200)).body.notes).toEqual([]);
  });

  it('takes the same password and expiry as a link to a note, and one password serves the whole notebook', async () => {
    const { server, auth, soup, rye, sharePath, link } = await kitchen();
    const prisma = app.get(PrismaService);

    await request(server).patch(sharePath).set(auth).send({ password: 'open sesame' }).expect(200);
    expect((await request(server).get(link).expect(403)).body).toMatchObject({ passwordRequired: true });
    await request(server).get(`${link}/${soup}`).expect(403);
    await request(server).post(link).send({ password: 'open says me' }).expect(403);

    const opened = await request(server).post(link).send({ password: 'open sesame' }).expect(200);
    expect(opened.body).toMatchObject({ kind: 'notebook', name: 'Recipes' });
    const proof = { 'X-Share-Access': opened.body.access as string };

    // The proof of the password, not the password, goes with every note after that.
    expect((await request(server).get(`${link}/${soup}`).set(proof).expect(200)).body.title).toBe('Soup');
    expect((await request(server).get(`${link}/${rye}`).set(proof).expect(200)).body.title).toBe('Rye');
    await request(server).get(link).set(proof).expect(200);
    await request(server).get(`${link}/${soup}`).set({ 'X-Share-Access': 'made-up' }).expect(403);

    // A new password ends what the old one opened.
    await request(server).patch(sharePath).set(auth).send({ password: 'another one' }).expect(200);
    await request(server).get(`${link}/${soup}`).set(proof).expect(403);

    await prisma.shareLink.updateMany({
      where: { notebookId: { not: null }, token: link.split('/').pop() },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const never = await request(server).get('/api/public/notes/there-is-no-such-link').expect(404);
    expect((await request(server).get(link).expect(404)).body).toEqual(never.body);
    expect((await request(server).get(`${link}/${soup}`).set(proof).expect(404)).body).toEqual(never.body);
    expect((await request(server).get(sharePath).set(auth).expect(200)).body.share).toMatchObject({ expired: true });
  });

  it('ends with the notebook, and a link has to be for a note or for a notebook', async () => {
    const { server, auth, recipes, soup, link, sharePath } = await kitchen();
    const prisma = app.get(PrismaService);
    const stranger = await signUp();

    await request(server).post(sharePath).set(stranger.auth).expect(404);
    await request(server).get(sharePath).set(stranger.auth).expect(404);

    await expect(prisma.shareLink.create({ data: { token: `neither-${Date.now()}` } })).rejects.toThrow();
    await expect(
      prisma.shareLink.create({ data: { token: `both-${Date.now()}`, noteId: soup, notebookId: recipes } }),
    ).rejects.toThrow();

    await request(server).delete(`/api/notebooks/${recipes}`).set(auth).expect(200);
    await request(server).get(link).expect(404);
    await request(server).get(`${link}/${soup}`).expect(404);
  });
});

describe('links between shared notes', () => {
  it('lead to the other note only while that note has a live link of its own', async () => {
    const server = app.getHttpServer();
    const prisma = app.get(PrismaService);
    const { auth } = await signUp();
    const starter = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Starter', content: 'Flour and water.' });
    const bread = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Bread', content: 'Feed the [[Starter|starter culture]] first.' });
    const shared = await request(server).post(`/api/notes/${bread.body.id}/share`).set(auth).expect(200);
    const link = `/api/public/notes/${shared.body.token as string}`;

    // The other note is private: its title is not in what readers get, only the words written for it.
    const alone = await request(server).get(link).expect(200);
    expect(alone.body).toMatchObject({ kind: 'note', content: 'Feed the starter culture first.', links: {} });
    expect(JSON.stringify(alone.body)).not.toContain('Starter');

    const other = await request(server).post(`/api/notes/${starter.body.id}/share`).set(auth).expect(200);
    const both = await request(server).get(link).expect(200);
    expect(both.body).toMatchObject({
      content: 'Feed the [[Starter|starter culture]] first.',
      links: { starter: `/s/${other.body.token as string}` },
    });

    // A newer private note of the same title does not take the link's place.
    await request(server).post('/api/notes').set(auth).send({ title: 'Starter', content: 'Private.' }).expect(201);
    expect((await request(server).get(link).expect(200)).body).toEqual(both.body);

    // Behind a password, the other note is no place to follow to: neither its token nor its title get out.
    const starterShare = `/api/notes/${starter.body.id}/share`;
    await request(server).patch(starterShare).set(auth).send({ password: 'open sesame' }).expect(200);
    const locked = await request(server).get(link).expect(200);
    expect(locked.body).toMatchObject({ content: 'Feed the starter culture first.', links: {} });
    expect(JSON.stringify(locked.body)).not.toContain('Starter');
    expect(JSON.stringify(locked.body)).not.toContain(other.body.token as string);
    await request(server).patch(starterShare).set(auth).send({ password: null }).expect(200);

    await prisma.shareLink.update({
      where: { noteId: starter.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await request(server).get(link).expect(200)).body).toMatchObject({
      content: 'Feed the starter culture first.',
      links: {},
    });
  });

  it('leads from a single shared note to a note that only a shared notebook covers: it does not', async () => {
    const server = app.getHttpServer();
    const { auth } = await signUp();
    const notebook = await request(server).post('/api/notebooks').set(auth).send({ name: 'Kitchen' }).expect(201);
    await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Starter', notebookId: notebook.body.id })
      .expect(201);
    await request(server)
      .post(`/api/notebooks/${notebook.body.id as string}/share`)
      .set(auth)
      .expect(200);
    const bread = await request(server)
      .post('/api/notes')
      .set(auth)
      .send({ title: 'Bread', content: 'See [[Starter]].' });
    const shared = await request(server).post(`/api/notes/${bread.body.id}/share`).set(auth).expect(200);

    const read = await request(server)
      .get(`/api/public/notes/${shared.body.token as string}`)
      .expect(200);
    expect(read.body).toMatchObject({ content: 'See Starter.', links: {} });
  });
});

describe('the JSON backup', () => {
  interface Backup {
    format: string;
    version: number;
    notebooks: { id: string; name: string; parentId: string | null }[];
    tags: { name: string }[];
    preferences: { dailyNotes: { notebookId: string | null; templateId: string | null; dateFormat: string } };
    shareLinks: { noteId: string | null; notebookId: string | null; hasPassword: boolean }[];
    notes: {
      id: string;
      title: string;
      notebookId: string | null;
      deletedAt: string | null;
      revision: number;
      versions: { title: string; content: string; createdAt: string }[];
      [key: string]: unknown;
    }[];
  }

  const download = async (auth: { Authorization: string }) => {
    const response = await request(app.getHttpServer())
      .get('/api/export/backup')
      .set(auth)
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => done(null, body));
      })
      .expect(200);
    expect(response.headers['content-type']).toMatch(/^application\/json/);
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="notes-backup-.*\.json"$/);
    return { raw: response.body as string, backup: JSON.parse(response.body as string) as Backup };
  };

  /** The backup with ids replaced by names, which is what has to come back the same. */
  const comparable = (backup: Backup) => {
    const notebook = new Map(backup.notebooks.map((item) => [item.id, item.name]));
    const note = new Map(backup.notes.map((item) => [item.id, item.title]));
    const daily = backup.preferences.dailyNotes;
    return {
      preferences: {
        ...daily,
        notebookId: daily.notebookId && notebook.get(daily.notebookId),
        templateId: daily.templateId && note.get(daily.templateId),
      },
      notebooks: backup.notebooks
        .map((item) => ({ ...item, id: undefined, parentId: item.parentId && notebook.get(item.parentId) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      tags: backup.tags,
      notes: backup.notes
        .map((item) => ({ ...item, id: undefined, notebookId: item.notebookId && notebook.get(item.notebookId) }))
        .sort((a, b) => a.title.localeCompare(b.title)),
      shared: backup.shareLinks.map((link) =>
        link.noteId ? note.get(link.noteId) : notebook.get(link.notebookId ?? ''),
      ),
    };
  };

  it('restores into an empty account with the same notes, history, trash and structure', async () => {
    const server = app.getHttpServer();
    const prisma = app.get(PrismaService);
    const owner = await signUp();
    const make = async (path: string, body: object) =>
      (await request(server).post(path).set(owner.auth).send(body).expect(201)).body;

    const work = await make('/api/notebooks', { name: 'Work' });
    const meetings = await make('/api/notebooks', { name: 'Meetings', parentId: work.id });
    const plan = await make('/api/notes', {
      title: 'Plan',
      content: 'See [[Monday]].',
      notebookId: work.id,
      tags: ['q1'],
    });
    const monday = await make('/api/notes', { title: 'Monday', content: 'Agenda', notebookId: meetings.id });
    await request(server)
      .patch(`/api/notes/${monday.id as string}`)
      .set(owner.auth)
      .send({ content: 'Agenda, revised', revision: monday.revision })
      .expect(200);
    await prisma.noteVersion.create({
      data: { noteId: monday.id, title: 'Monday', content: 'Agenda', createdAt: new Date('2026-01-05T09:00:00Z') },
    });
    const template = await make('/api/notes', { title: 'Day', content: '## Plan', isTemplate: true });
    await prisma.note.update({ where: { id: plan.id }, data: { dailyDate: new Date('2026-03-02T00:00:00Z') } });
    await prisma.user.update({
      where: { id: (await prisma.note.findUniqueOrThrow({ where: { id: plan.id } })).userId },
      data: { preferences: { dailyNotes: { notebookId: work.id, templateId: template.id, dateFormat: 'long' } } },
    });
    const old = await make('/api/notes', { title: 'Old idea', content: 'Gone' });
    await request(server)
      .delete(`/api/notes/${old.id as string}`)
      .set(owner.auth)
      .expect(204);
    const share = await request(server)
      .post(`/api/notes/${plan.id as string}/share`)
      .set(owner.auth)
      .expect(200);
    await request(server)
      .patch(`/api/notes/${plan.id as string}/share`)
      .set(owner.auth)
      .send({ password: 'open sesame' })
      .expect(200);

    const { raw, backup } = await download(owner.auth);
    expect(backup).toMatchObject({ format: 'notes-backup', version: 1 });
    expect(backup.notes).toHaveLength(4);
    expect(backup.notes.find((note) => note.title === 'Day')).toMatchObject({ isTemplate: true });
    expect(backup.notes.find((note) => note.title === 'Plan')).toMatchObject({ dailyDate: '2026-03-02' });
    expect(backup.notes.find((note) => note.title === 'Old idea')?.deletedAt).not.toBeNull();
    expect(backup.notes.find((note) => note.title === 'Monday')).toMatchObject({
      revision: 1,
      content: 'Agenda, revised',
      // Oldest first: the one put in by hand, then the one the edit above kept.
      versions: [
        { title: 'Monday', content: 'Agenda', createdAt: '2026-01-05T09:00:00.000Z' },
        { title: 'Monday', content: 'Agenda', createdAt: expect.any(String) },
      ],
    });
    expect(backup.shareLinks).toEqual([expect.objectContaining({ noteId: plan.id, hasPassword: true })]);
    // Nothing that would open the share: no token, no hash.
    expect(raw).not.toContain(share.body.token as string);
    expect(raw).not.toMatch(/\$2[aby]\$/);
    expect(raw).not.toContain('passwordHash');

    const fresh = await signUp();
    const restored = await request(server)
      .post('/api/import/backup')
      .set(fresh.auth)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from(raw))
      .expect(201);
    expect(restored.body).toEqual({ notes: 4, notebooks: 2, tags: 1, versions: 2, shareLinksNotRestored: 1 });

    const again = await download(fresh.auth);
    const { shared, ...rest } = comparable(again.backup);
    const { shared: sharedBefore, ...before } = comparable(backup);
    expect(rest).toEqual(before);
    expect(sharedBefore).toEqual(['Plan']);
    expect(before.preferences).toEqual({ notebookId: 'Work', templateId: 'Day', dateFormat: 'long' });
    expect(shared).toEqual([]);

    // The structure works in the app, not only in the file: links, trash and nesting.
    const list = await request(server).get('/api/notes').set(fresh.auth).expect(200);
    const restoredPlan = list.body.items.find((item: { title: string }) => item.title === 'Plan');
    const links = await request(server)
      .get(`/api/notes/${restoredPlan.id as string}/links`)
      .set(fresh.auth)
      .expect(200);
    expect(links.body).toEqual([{ title: 'Monday', noteId: expect.any(String) }]);
    const trash = await request(server).get('/api/trash').set(fresh.auth).expect(200);
    expect(JSON.stringify(trash.body)).toContain('Old idea');
    // The owner's data only: the first account's backup is unchanged by any of this.
    expect(comparable((await download(owner.auth)).backup)).toEqual(comparable(backup));
  });

  it('downloads through a link that works once, without a login', async () => {
    const server = app.getHttpServer();
    const owner = await signUp();
    await request(server).post('/api/notes').set(owner.auth).send({ title: 'Linked' }).expect(201);
    const { url } = (await request(server).post('/api/export/backup/link').set(owner.auth).expect(201)).body as {
      url: string;
    };
    expect(url).toMatch(/^\/api\/export\/backup\/download\?ticket=/);

    const first = await request(server)
      .get(url)
      .buffer(true)
      .parse((res, done) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        res.on('end', () => done(null, body));
      });
    expect(first.status).toBe(200);
    expect(first.headers['content-disposition']).toMatch(/^attachment; filename="notes-backup-/);
    expect((JSON.parse(first.body as string) as Backup).notes.map((note) => note.title)).toEqual(['Linked']);

    await request(server).get(url).expect(404);
    await request(server)
      .get(url.replace(/.$/, (last) => (last === 'A' ? 'B' : 'A')))
      .expect(404);
    await request(server).get('/api/export/backup/download').expect(404);
  });

  it('restores a backup larger than any fixed cap, read as it comes in', async () => {
    const server = app.getHttpServer();
    const fresh = await signUp();
    const at = '2026-01-01T00:00:00.000Z';
    const count = 20_001;
    const notes = Array.from({ length: count }, (_, index) =>
      JSON.stringify({
        id: `n${index}`,
        title: `Note ${index}`,
        content: '',
        notebookId: index % 2 ? 'nb' : null,
        tags: index % 100 === 0 ? ['every-hundredth'] : [],
        pinned: false,
        favorite: false,
        isTemplate: false,
        dailyDate: null,
        dailyReleased: false,
        revision: 0,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        versions: [],
      }),
    );
    const file =
      `{"format":"notes-backup","version":1,"exportedAt":"${at}","preferences":{},` +
      `"notebooks":[{"id":"nb","name":"Half","parentId":null,"createdAt":"${at}","updatedAt":"${at}"}],` +
      `"tags":[],"shareLinks":[],"notes":[\n${notes.join(',\n')}\n]}`;

    const restored = await request(server)
      .post('/api/import/backup')
      .set(fresh.auth)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from(file))
      .expect(201);
    expect(restored.body).toEqual({ notes: count, notebooks: 1, tags: 1, versions: 0, shareLinksNotRestored: 0 });
    const tagged = await request(server).get('/api/notes?tag=every-hundredth&pageSize=1').set(fresh.auth).expect(200);
    expect(tagged.body.total).toBe(201);
  }, 120_000);

  it('restores only into an empty account, and only a file it can read', async () => {
    const server = app.getHttpServer();
    const someone = await signUp();
    await request(server).post('/api/notes').set(someone.auth).send({ title: 'Mine' }).expect(201);
    const { raw } = await download(someone.auth);

    const busy = await request(server)
      .post('/api/import/backup')
      .set(someone.auth)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from(raw))
      .expect(409);
    expect(busy.body.message).toMatch(/empty account/);

    const empty = await signUp();
    // Not sent as the file itself.
    await request(server)
      .post('/api/import/backup')
      .set(empty.auth)
      .attach('file', Buffer.from(raw), 'backup.json')
      .expect(415);
    const broken = JSON.parse(raw) as Backup;
    broken.notes[0].notebookId = 'nowhere';
    for (const [file, message] of [
      ['not json', /not JSON/],
      [JSON.stringify({ format: 'something-else' }), /is not a notes-backup file/],
      [JSON.stringify(broken), /notes\[0\]\.notebookId names no notebook/],
      [raw.slice(0, raw.length - 10), /ends too early/],
    ] as const) {
      const response = await request(server)
        .post('/api/import/backup')
        .set(empty.auth)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from(file))
        .expect(400);
      expect(response.body.message).toMatch(message);
    }
    expect((await request(server).get('/api/notes').set(empty.auth).expect(200)).body.items).toEqual([]);
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
    expect(imported.body).toEqual({
      imported: 1,
      notebooksCreated: 1,
      duplicates: 0,
      attachmentsSkipped: 0,
      skipped: [],
    });

    const list = await request(server).get('/api/notes?tag=baking').set(other.auth).expect(200);
    expect(list.body.items[0]).toMatchObject({ title: 'Bread', tags: ['baking'] });

    // The same zip again: nothing new, unless asked for.
    const again = await request(server)
      .post('/api/import')
      .set(other.auth)
      .attach('files', exported.body as Buffer, 'export.zip')
      .expect(201);
    expect(again.body).toMatchObject({ imported: 0, duplicates: 1, notebooksCreated: 0 });
    const twice = await request(server)
      .post('/api/import')
      .set(other.auth)
      .field('skipExisting', 'false')
      .attach('files', exported.body as Buffer, 'export.zip')
      .expect(201);
    expect(twice.body).toMatchObject({ imported: 1, duplicates: 0 });
    await request(server)
      .post('/api/import')
      .set(other.auth)
      .field('skipExisting', 'maybe')
      .attach('files', exported.body as Buffer, 'export.zip')
      .expect(400);
  });

  it('imports an Evernote export with its links synced, and the text stays text', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const enex = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export><note><title>Garden</title><content><![CDATA[<en-note><div>Water the [[Tomatoes]] &lt;script&gt;</div><script>x()</script><en-media hash="a" type="image/png"/></en-note>]]></content><created>20250301T090000Z</created><tag>home</tag><resource/></note></en-export>`;

    const imported = await request(server)
      .post('/api/import')
      .set(auth)
      .attach('files', Buffer.from(enex), 'Home.enex')
      .expect(201);
    expect(imported.body).toMatchObject({ imported: 1, notebooksCreated: 1, attachmentsSkipped: 1, skipped: [] });

    const list = await request(server).get('/api/notes?tag=home').set(auth).expect(200);
    const note = await request(server)
      .get(`/api/notes/${list.body.items[0].id as string}`)
      .set(auth)
      .expect(200);
    expect(note.body).toMatchObject({
      title: 'Garden',
      content: 'Water the \\[\\[Tomatoes\\]\\] <script>',
      notebook: { name: 'Home' },
      createdAt: '2025-03-01T09:00:00.000Z',
    });
  });

  it('imports a Notion export with links between its pages', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const id = 'a'.repeat(32);
    const other = 'b'.repeat(32);
    const zip = new JSZip();
    zip.file(`Ideas ${id}.md`, `# Ideas\n\nSee [Next](Ideas%20${id}/Next%20${other}.md).`);
    zip.file(`Ideas ${id}/Next ${other}.md`, '# Next\n\nSoon.');
    const imported = await request(server)
      .post('/api/import')
      .set(auth)
      .attach('files', await zip.generateAsync({ type: 'nodebuffer' }), 'notion.zip')
      .expect(201);
    expect(imported.body).toMatchObject({ imported: 2, notebooksCreated: 1 });

    const ideas = (await request(server).get('/api/notes?sort=title').set(auth).expect(200)).body.items.find(
      (item: { title: string }) => item.title === 'Ideas',
    );
    const links = await request(server)
      .get(`/api/notes/${ideas.id as string}/links`)
      .set(auth)
      .expect(200);
    expect(links.body).toEqual([{ title: 'Next', noteId: expect.any(String) }]);
  });
});

/** A second app on the same database, with other settings. One proxy is trusted, so a test can come from several addresses. */
async function startApp(settings: Partial<AppConfig>): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue({ ...loadConfig(), ...settings })
    .overrideProvider(MAIL_TRANSPORT)
    .useValue(fakeTransport)
    .compile();
  const nest: INestApplication<App> = moduleRef.createNestApplication();
  setupApp(nest, { trustProxy: 1 });
  await nest.init();
  return nest;
}

/**
 * The suites above run with a throttle limit too high to notice. This one
 * has an app of its own with a limit of three, to see the routes that check
 * the password count their requests at all.
 */
describe('password guesses with a low throttle limit', () => {
  let limited: INestApplication<App>;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    limited = await startApp({ authThrottleLimit: 3, publicThrottleLimit: 5 });
  });

  afterAll(async () => {
    await limited.close();
  });

  const from = (address: string) => ({ 'X-Forwarded-For': address });
  let accounts = 0;
  /** Signs up from an address of its own: one address gets three sign-ups a minute here. */
  const account = async (name: string) => {
    const response = await request(limited.getHttpServer())
      .post('/api/auth/register')
      .set(from(`192.0.2.${100 + ++accounts}`))
      .send({ email: `${name}-${Date.now()}-${accounts}@example.com`, name, password: 'password123' })
      .expect(201);
    return bearer(response.body.token);
  };

  it('serves no API document when it is not set up, which is what API_DOCS=false does', async () => {
    const server = limited.getHttpServer();
    await request(server).get('/api/docs').expect(404);
    await request(server).get('/api/docs/').expect(404);
    await request(server).get('/api/docs-json').expect(404);
    await request(server).get('/api/docs/swagger-ui.css').expect(404);
    await request(server).get('/api/health').expect(200);
  });

  const shareWithPassword = async (owner: { Authorization: string }, title: string) => {
    const server = limited.getHttpServer();
    const note = await request(server).post('/api/notes').set(owner).send({ title }).expect(201);
    const link = await request(server)
      .post(`/api/notes/${note.body.id}/share`)
      .set(owner)
      .send({ password: 'open sesame' })
      .expect(200);
    return `/api/public/notes/${link.body.token as string}`;
  };

  it('lets a client read a handful of shared notes a minute, with the roomy allowance and not the strict one', async () => {
    const server = limited.getHttpServer();
    const link = await shareWithPassword(await account('sharer'), 'First');

    for (let i = 0; i < 5; i++) {
      await request(server).get(link).set(from('203.0.113.1')).expect(403);
    }
    const refused = await request(server).get(link).set(from('203.0.113.1')).expect(429);
    expect(refused.headers['retry-after']).toBeDefined();
    // Not to be kept either, although no handler ran.
    expect(refused.headers['cache-control']).toBe('no-store');
    await request(server).get(link).set(from('203.0.113.2')).expect(403);
  });

  it('takes three wrong passwords a minute for a link, whoever sends them, and never holds the owner back', async () => {
    const server = limited.getHttpServer();
    const owner = await account('sharer');
    const first = await shareWithPassword(owner, 'First');
    const second = await shareWithPassword(owner, 'Second');
    const guess = (link: string, address: string, password: string) =>
      request(server).post(link).set(from(address)).send({ password });

    // Guessing from a new address every time: the link itself stops taking passwords after three wrong ones.
    await guess(first, '198.51.100.1', 'guess-1').expect(403);
    await guess(first, '198.51.100.2', 'guess-2').expect(403);
    await guess(first, '198.51.100.3', 'guess-3').expect(403);
    const refused = await guess(first, '198.51.100.4', 'guess-4').expect(429);
    expect(refused.body.message).toBe('Too many wrong passwords for this link. Try again in a minute.');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(refused.headers['cache-control']).toBe('no-store');
    // The right password does not get through either until the minute is over.
    await guess(first, '198.51.100.5', 'open sesame').expect(429);

    // The owner, signed in, is not held back by what others did to the link.
    await guess(first, '198.51.100.6', 'open sesame').set(owner).expect(200);
    await guess(first, '198.51.100.6', 'mistyped').set(owner).expect(403);

    // Another link is not affected.
    await guess(second, '198.51.100.7', 'open sesame').expect(200);
  });

  it('does not count right passwords against a link, only against the client that sends them', async () => {
    const server = limited.getHttpServer();
    const link = await shareWithPassword(await account('sharer'), 'Popular');
    const open = (address: string, password = 'open sesame') =>
      request(server).post(link).set(from(address)).send({ password });

    // More readers in a minute than the link takes wrong passwords.
    for (let reader = 1; reader <= 5; reader++) {
      await open(`192.0.2.${reader}`).expect(200);
    }
    // Two wrong ones leave room for a third attempt.
    await open('192.0.2.10', 'guess-1').expect(403);
    await open('192.0.2.11', 'guess-2').expect(403);
    await open('192.0.2.12').expect(200);

    // One address still has only its own three requests a minute on the route.
    await open('192.0.2.20').expect(200);
    await open('192.0.2.20').expect(200);
    await open('192.0.2.20').expect(200);
    await open('192.0.2.20').expect(429);
  });

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

/**
 * AUTH_THROTTLE_LIMIT and PUBLIC_THROTTLE_LIMIT each rule their own routes.
 * The suite above has the strict limit below the roomy one. Here it is the
 * other way round and far apart: if reading shared notes were counted on
 * the password routes as well, they would close after two requests.
 */
describe('throttle limits far apart', () => {
  let nest: INestApplication<App>;

  beforeAll(async () => {
    nest = await startApp({ authThrottleLimit: 8, publicThrottleLimit: 2 });
  });

  afterAll(async () => {
    await nest.close();
  });

  it('gives every route the allowance that is meant for it', async () => {
    const server = nest.getHttpServer();
    const email = `far-apart-${Date.now()}@example.com`;
    const signedUp = await request(server)
      .post('/api/auth/register')
      .send({ email, name: 'Far', password: 'password123' })
      .expect(201);
    const auth = { Authorization: `Bearer ${signedUp.body.token as string}` };
    const note = await request(server).post('/api/notes').set(auth).send({ title: 'Open' }).expect(201);
    const link = await request(server).post(`/api/notes/${note.body.id}/share`).set(auth).expect(200);
    const shared = `/api/public/notes/${link.body.token as string}`;

    /** How many requests in a row are answered with `status` before the first 429. */
    const allowance = async (send: () => request.Test, status: number): Promise<number> => {
      for (let count = 0; count < 20; count++) {
        const response = await send();
        if (response.status === 429) return count;
        expect(response.status).toBe(status);
      }
      return 20;
    };

    // Reading shared notes: two.
    expect(await allowance(() => request(server).get(shared), 200)).toBe(2);

    // Everything that takes a password or sends mail: eight, not two.
    const login = () => request(server).post('/api/auth/login').send({ email, password: 'guess' });
    expect(await allowance(login, 401)).toBe(8);
    const forgot = () => request(server).post('/api/auth/password-reset').send({ email: 'nobody@example.com' });
    expect(await allowance(forgot, 204)).toBe(8);
    const change = () =>
      request(server)
        .patch('/api/auth/password')
        .set(auth)
        .send({ currentPassword: 'guess', newPassword: 'x'.repeat(12) });
    expect(await allowance(change, 403)).toBe(8);
    const register = () => request(server).post('/api/auth/register').send({ email: 'not an address' });
    // One was used to sign up above.
    expect(await allowance(register, 400)).toBe(7);
  });
});
