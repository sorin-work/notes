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
import JSZip from 'jszip';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ALLOW_API_TOKEN } from '../src/common/allow-api-token.decorator';
import { IS_PUBLIC } from '../src/common/public.decorator';
import { APP_CONFIG, loadConfig } from '../src/config/config';
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
      'AuthController.updateProfile',
    ]);
    expect(names(routes.filter((route) => route.isPublic))).toEqual([
      'AuthController.login',
      'AuthController.register',
      'HealthController.check',
      'PasswordResetController.confirm',
      'PasswordResetController.request',
      'PasswordResetController.status',
      'PublicSharesController.view',
    ]);
    expect([...new Set(open.map((route) => route.name.split('.')[0]))].sort()).toEqual([
      'AuthController',
      'MentionsController',
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

describe('orphans and unlinked mentions', () => {
  it('lists the notes with no links in or out', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const post = async (body: object) =>
      (await request(server).post('/api/notes').set(auth).send(body).expect(201)).body.id as string;

    await post({ title: 'Hub', content: 'See [[ atlas  PLAN ]] and [[Nowhere]].' });
    await post({ title: 'Atlas plan', content: 'No links here.' });
    const alone = await post({ title: 'Alone', content: 'Mentions Hub in plain words only.', tags: ['solo'] });
    const trashed = await post({ title: 'Gone', content: 'See [[Stray]].' });
    const stray = await post({ title: 'Stray', content: 'Only linked from the trash.' });
    await request(server).delete(`/api/notes/${trashed}`).set(auth).expect(204);
    // A link connects two notes outside the trash. These three lead nowhere of that kind.
    const dangling = await post({ title: 'Dangling', content: 'Only to [[A note that is missing]].' });
    const selfish = await post({ title: 'Selfish', content: 'Only to [[Selfish]] itself.' });
    const lost = await post({ title: 'Lost', content: 'Only to [[Gone]], which is in the trash.' });

    const orphans = async (query = '') => {
      const response = await request(server).get(`/api/notes?orphans=true&sort=title${query}`).set(auth).expect(200);
      return response.body.items.map((note: { id: string }) => note.id) as string[];
    };
    // "Hub" links to "Atlas plan", which makes neither of them an orphan.
    expect(await orphans()).toEqual([alone, dangling, lost, selfish, stray]);
    expect(await orphans('&tag=solo')).toEqual([alone]);
    const all = await request(server).get('/api/notes?orphans=false').set(auth).expect(200);
    expect(all.body.total).toBe(7);
  });

  it('finds unlinked mentions and turns the one it showed into a link that can be undone', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    type Found = { id: string; before: string; match: string; after: string; offset: number; version: number };
    const post = async (body: object, headers = auth) =>
      (await request(server).post('/api/notes').set(headers).send(body).expect(201)).body.id as string;
    const mentions = async (id: string, query = '') => {
      const response = await request(server).get(`/api/notes/${id}/mentions${query}`).set(auth).expect(200);
      return response.body as { items: Found[]; total: number; capped: boolean };
    };
    const link = (target: string, found: Found, headers = auth) =>
      request(server)
        .post(`/api/notes/${target}/mentions/${found.id}/link`)
        .set(headers)
        .send({ offset: found.offset, text: found.match, version: found.version });

    const atlas = await post({ title: 'Project Atlas', content: 'The plan.' });
    const text =
      '# Minutes\n\nIn `project atlas` code first. We agreed that project atlas ships in March.\n\nProject Atlas needs a budget.';
    const plain = await post({ title: 'Minutes', content: text });
    await post({ title: 'Linked', content: 'Already links to [[Project Atlas]], and names Project Atlas again.' });
    await post({ title: 'Code', content: 'Only in code: `Project Atlas`\n\n```\nProject Atlas\n```' });
    await post({
      title: 'Address',
      content: 'Only in [a link](https://x.test/a_(b)/project atlas) and www.project-atlas.org.',
    });
    await post({ title: 'Stems', content: 'Projects and atlases, but never the two words together.' });
    await post({ title: 'Project Atlas notes', content: 'The title has the words, the text does not.' });
    const trashed = await post({ title: 'Old', content: 'Project Atlas, from the trash.' });
    await request(server).delete(`/api/notes/${trashed}`).set(auth).expect(204);
    await post({ title: 'Theirs', content: 'Project Atlas in another account.' }, other.auth);

    const found = await mentions(atlas);
    expect(found).toMatchObject({ total: 1, capped: false });
    // What is shown is the mention that will be linked: the one in the sentence, not the one in code before it.
    expect(found.items).toEqual([
      expect.objectContaining({
        id: plain,
        title: 'Minutes',
        before: 'In project atlas code first. We agreed that ',
        match: 'project atlas',
        after: ' ships in March.',
        offset: text.indexOf('project atlas ships'),
      }),
    ]);
    const shown = found.items[0];
    expect((await mentions(atlas, '?page=2&pageSize=1')).items).toEqual([]);

    // Short titles, notes of other accounts and unknown notes get nothing.
    const short = await post({ title: 'We', content: 'x' });
    expect((await mentions(short)).total).toBe(0);
    await request(server).get(`/api/notes/${atlas}/mentions`).set(other.auth).expect(404);
    await link(atlas, shown, other.auth).expect(404);
    // The body has to name the mention.
    await request(server).post(`/api/notes/${atlas}/mentions/${plain}/link`).set(auth).send({}).expect(400);

    // The note changes after the list was made: nothing is linked until the list is asked for again.
    await request(server)
      .patch(`/api/notes/${plain}`)
      .set(auth)
      .send({ content: `Intro.\n\n${text}` })
      .expect(200);
    const stale = await link(atlas, shown).expect(409);
    expect(stale.body.message).toContain('has changed since');
    const again = (await mentions(atlas)).items[0];
    expect(again.offset).toBe(shown.offset + 8);

    const before = await request(server).get(`/api/notes/${plain}`).set(auth).expect(200);
    await link(atlas, again).expect(204);
    const after = await request(server).get(`/api/notes/${plain}`).set(auth).expect(200);
    expect(after.body.content).toBe(
      'Intro.\n\n# Minutes\n\nIn `project atlas` code first. We agreed that [[project atlas]] ships in March.\n\nProject Atlas needs a budget.',
    );
    // The app made this change, so the note keeps its place in "last edited". Its revision counts it all the same.
    expect(after.body.updatedAt).toBe(before.body.updatedAt);
    expect(after.body.revision).toBe(before.body.revision + 1);
    expect(again.version).toBe(before.body.revision);

    // It is a backlink now and no longer a mention, and the old text is in the history.
    const backlinks = await request(server).get(`/api/notes/${atlas}/backlinks`).set(auth).expect(200);
    expect(backlinks.body.map((item: { id: string }) => item.id)).toContain(plain);
    expect((await mentions(atlas)).total).toBe(0);
    const versions = await request(server).get(`/api/notes/${plain}/versions`).set(auth).expect(200);
    const texts = await Promise.all(
      versions.body.map(async (version: { id: string }) => {
        const one = await request(server).get(`/api/notes/${plain}/versions/${version.id}`).set(auth).expect(200);
        return one.body.content as string;
      }),
    );
    expect(texts).toContain(before.body.content);

    // The same request again finds the note changed, and the search index follows the new text.
    await link(atlas, again).expect(409);
    const search = await request(server).get('/api/search').query({ q: '"project atlas ships"' }).set(auth);
    expect(search.body.items.map((hit: { id: string }) => hit.id)).toEqual([plain]);
  });

  it('offers no mentions of a title that is not one note alone, and links none', async () => {
    const { auth } = await signUp();
    const server = app.getHttpServer();
    const post = async (body: object) =>
      (await request(server).post('/api/notes').set(auth).send(body).expect(201)).body.id as string;
    const total = async (id: string) =>
      (await request(server).get(`/api/notes/${id}/mentions`).set(auth).expect(200)).body.total as number;

    const first = await post({ title: 'Atlas', content: 'The first.' });
    await post({ title: 'Minutes', content: 'We looked at the atlas.' });
    const listed = await request(server).get(`/api/notes/${first}/mentions`).set(auth).expect(200);
    expect(listed.body.total).toBe(1);
    const shown = listed.body.items[0];

    // A second note takes the title, in other letters. A link would now lead to that one.
    const second = await post({ title: 'atlas', content: 'The second.' });
    expect(await total(first)).toBe(0);
    expect(await total(second)).toBe(0);
    const refused = await request(server)
      .post(`/api/notes/${first}/mentions/${shown.id}/link`)
      .set(auth)
      .send({ offset: shown.offset, text: shown.match, version: shown.version })
      .expect(409);
    expect(refused.body.message).toContain('Another note has the same title');
    // In the trash it does not count, and the mention is back.
    await request(server).delete(`/api/notes/${second}`).set(auth).expect(204);
    expect(await total(first)).toBe(1);

    const untitled = await post({ content: 'No title given.' });
    await post({ title: 'About', content: 'Still untitled, that one.' });
    expect(await total(untitled)).toBe(0);
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

describe('graph', () => {
  it('returns notes as nodes and resolved links as edges, narrowed by notebook and tag', async () => {
    const { auth } = await signUp();
    const other = await signUp();
    const server = app.getHttpServer();
    const post = async (path: string, body: object, headers = auth) =>
      (await request(server).post(path).set(headers).send(body).expect(201)).body.id as string;
    const graph = async (query: Record<string, string> = {}) => {
      const response = await request(server).get('/api/links/graph').query(query).set(auth).expect(200);
      return response.body as { nodes: { id: string; title: string }[]; edges: object[]; total: number };
    };

    const work = await post('/api/notebooks', { name: 'Work' });
    const inner = await post('/api/notebooks', { name: 'Atlas', parentId: work });
    // Two notes share a title. Links go to the one edited last, as everywhere else.
    const olderPlan = await post('/api/notes', { title: 'Plan', content: 'The first plan.' });
    const plan = await post('/api/notes', {
      title: 'plan',
      content: 'See [[Hub]].',
      notebookId: inner,
      tags: ['atlas'],
    });
    const hub = await post('/api/notes', {
      title: 'Hub',
      content: 'Links to [[ PLAN ]], [[Plan|again]], [[Hub]], [[Missing]] and [[Gone]].',
      notebookId: work,
      tags: ['atlas'],
    });
    const alone = await post('/api/notes', { title: 'Alone', content: 'No links.' });
    const gone = await post('/api/notes', { title: 'Gone', content: 'See [[Hub]].' });
    await request(server).delete(`/api/notes/${gone}`).set(auth).expect(204);
    await post('/api/notes', { title: 'Hub', content: 'See [[Plan]].' }, other.auth);

    const all = await graph();
    expect(all.total).toBe(4);
    // Newest first.
    expect(all.nodes.map((node) => node.id)).toEqual([alone, hub, plan, olderPlan]);
    expect(all.nodes[1]).toEqual({ id: hub, title: 'Hub' });
    // One edge each way between the hub and the newer plan. Nothing for the note linking to itself,
    // the missing note, the note in the trash or the other account.
    const edges = [
      { source: hub, target: plan },
      { source: plan, target: hub },
    ].sort((a, b) => a.source.localeCompare(b.source));
    expect(all.edges).toEqual(edges);

    // A top-level notebook covers the notebooks inside it.
    expect((await graph({ notebookId: work })).nodes.map((node) => node.id)).toEqual([hub, plan]);
    const innerOnly = await graph({ notebookId: inner });
    expect(innerOnly).toMatchObject({ total: 1, nodes: [{ id: plan, title: 'plan' }], edges: [] });
    expect((await graph({ notebookId: 'none' })).nodes.map((node) => node.id)).toEqual([alone, olderPlan]);
    expect((await graph({ tag: '#Atlas' })).edges).toHaveLength(2);
    expect((await graph({ notebookId: 'none', tag: 'atlas' })).total).toBe(0);

    const foreign = await post('/api/notebooks', { name: 'Theirs' }, other.auth);
    await request(server).get('/api/links/graph').query({ notebookId: foreign }).set(auth).expect(404);
    await request(server).get('/api/links/graph').query({ notebookId: 'NONE' }).set(auth).expect(400);
    await request(server).get('/api/links/graph').expect(401);
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

  it('serves no API document when it is not set up, which is what API_DOCS=false does', async () => {
    const server = limited.getHttpServer();
    await request(server).get('/api/docs').expect(404);
    await request(server).get('/api/docs/').expect(404);
    await request(server).get('/api/docs-json').expect(404);
    await request(server).get('/api/docs/swagger-ui.css').expect(404);
    await request(server).get('/api/health').expect(200);
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
