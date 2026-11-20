import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { setupDocs } from './docs';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: config.logLevels });
  // Notes can be long; the default 100kb body limit is too small.
  app.useBodyParser('json', { limit: '5mb' });
  app.disable('x-powered-by');
  setupApp(app, { corsOrigins: config.corsOrigins, trustProxy: config.trustProxy });
  setupDocs(app);
  await app.listen(config.port);
  Logger.log(`API listening on :${config.port}`, 'Bootstrap');
}

void bootstrap();
