import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Express } from 'express';

export interface AppSetup {
  corsOrigins?: string[];
  /** Reverse proxies in front of the API, see TRUST_PROXY. */
  trustProxy?: number;
}

/** Settings shared by main.ts and the end-to-end tests. */
export function setupApp(app: INestApplication, { corsOrigins = [], trustProxy = 0 }: AppSetup = {}): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins });
  }
  if (trustProxy > 0) {
    // The throttles count per client address. Behind nginx every request
    // comes from nginx, so without this all clients share one allowance and
    // one of them can use it up for everybody. With it, the client is the
    // address that the last `trustProxy` proxies put in X-Forwarded-For.
    // Only right when clients cannot reach the API except through them:
    // anyone who can sets that header to whatever they like.
    (app.getHttpAdapter().getInstance() as Express).set('trust proxy', trustProxy);
  }
  app.enableShutdownHooks();
}
