import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { logger: config.logLevels });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`API listening on :${config.port}`, 'Bootstrap');
}

void bootstrap();
