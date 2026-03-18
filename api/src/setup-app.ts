import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Settings shared by main.ts and the end-to-end tests. */
export function setupApp(app: INestApplication, corsOrigins: string[] = []): void {
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
  app.enableShutdownHooks();
}
