import { INestApplication, Type } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALLOW_API_TOKEN } from './common/allow-api-token.decorator';
import { IS_PUBLIC } from './common/public.decorator';

/** Swagger UI is at /api/docs, the document itself at /api/docs-json. */
export const DOCS_PATH = 'api/docs';

const LOGIN = 'login';
const API_TOKEN = 'apiToken';
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

const DESCRIPTION = `
Everything the web app does goes through this API, and a script can do the same.

**Credentials.** Apart from the few public routes, a request needs an \`Authorization: Bearer ...\` header
with one of two things:

- a login token, the \`token\` in the answer of \`POST /api/auth/login\`. It lasts seven days, or until the
  password changes or \`POST /api/auth/logout-all\` is called.
- a personal API token from Settings in the web app. It starts with \`nt_\`, does not expire and works until
  it is revoked. A read-only token gets \`403\` on anything but \`GET\`. Each token may make a set number of
  requests a minute, then the answer is \`429\` with \`Retry-After\`.

Every route lists the credentials it takes. The ones that only list the login are the account and the tokens
themselves: an API token cannot change those.

**Errors** have the shape \`{ "statusCode": 400, "message": [...], "error": "Bad Request" }\`. Bodies are
checked strictly, and a field the API does not know is a \`400\`.

**What is missing.** The request side comes from the classes the API validates with. The answers are not
described here yet.
`.trim();

function version(): string {
  // One level up from both src/ and dist/.
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { version?: string };
  return manifest.version ?? '0.0.0';
}

export function buildApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Notes API')
    .setDescription(DESCRIPTION)
    .setVersion(version())
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'A login token: the `token` from `POST /api/auth/login` or `/api/auth/register`.',
      },
      LOGIN,
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'nt_...',
        description: 'A personal API token, made under Settings in the web app. Sent the same way as a login token.',
      },
      API_TOKEN,
    )
    .build();

  // Remembers which handler each operation came from, to look up below what the guard will ask of it.
  const handlers = new Map<string, { controller: string; method: string }>();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) => {
      const id = `${controller}_${method}`;
      handlers.set(id, { controller, method });
      return id;
    },
  });
  describeCredentials(app, document, handlers);
  return document;
}

/**
 * Says for every operation which credentials it takes, read from the same
 * @Public() and @AllowApiToken() marks that JwtAuthGuard goes by, so that the
 * document cannot say something else than the guard does. Also groups the
 * operations by the first part of their path.
 */
function describeCredentials(
  app: INestApplication,
  document: OpenAPIObject,
  handlers: Map<string, { controller: string; method: string }>,
): void {
  const reflector = app.get(Reflector);
  const controllers = new Map<string, Type>();
  for (const wrapper of app.get(DiscoveryService).getControllers()) {
    if (wrapper.metatype) controllers.set(wrapper.metatype.name, wrapper.metatype as Type);
  }

  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      operation.tags = [path.replace(/^\/api\//, '').split('/')[0]];

      // Until the marks say otherwise, the most that is claimed is "needs a login".
      operation.security = [{ [LOGIN]: [] }];
      const source = handlers.get(operation.operationId ?? '');
      const controller = source && controllers.get(source.controller);
      const handler = controller && (controller.prototype as Record<string, unknown>)[source.method];
      if (!controller || typeof handler !== 'function') continue;

      const targets = [handler, controller];
      if (reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
        operation.security = [];
      } else if (reflector.getAllAndOverride<boolean>(ALLOW_API_TOKEN, targets)) {
        operation.security = [{ [LOGIN]: [] }, { [API_TOKEN]: [] }];
      }
    }
  }
}

/** What the page at /api/docs loads, and with the page itself all that is served under that path. */
const PAGE_FILES = new Set([
  '/swagger-ui.css',
  '/swagger-ui-bundle.js',
  '/swagger-ui-standalone-preset.js',
  '/swagger-ui-init.js',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
]);

export function setupDocs(app: INestApplication): void {
  // SwaggerModule hands out the whole swagger-ui-dist folder under the docs
  // path, twice. In it is the stock index.html, reachable as
  // /api/docs/docs/ and /api/docs/index.html, whose script loads a sample
  // document from petstore.swagger.io. Nothing of that is wanted: only the
  // page made here and the files it asks for get through.
  app.use(`/${DOCS_PATH}`, (request: Request, response: Response, next: NextFunction) => {
    if (request.path === '/' || PAGE_FILES.has(request.path)) {
      next();
      return;
    }
    response.status(404).json({ statusCode: 404, message: 'Not found', error: 'Not Found' });
  });
  SwaggerModule.setup(DOCS_PATH, app, buildApiDocument(app), {
    customSiteTitle: 'Notes API',
    // The page shows the document it was built with. It asks no validator and no other host about it.
    swaggerOptions: { validatorUrl: null },
  });
}
