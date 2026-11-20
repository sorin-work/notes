import { Controller, INestApplication, Post, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import type { App } from 'supertest/types';
import { setupApp } from './setup-app';

@Controller('guess')
class GuessController {
  @UseGuards(ThrottlerGuard)
  @Post()
  guess(): { ok: true } {
    return { ok: true };
  }
}

/** A throttled route with an allowance of two a minute, and nothing else. */
async function appTrusting(trustProxy: number): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 2 }])],
    controllers: [GuessController],
  }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  setupApp(app, { trustProxy });
  await app.init();
  return app;
}

describe('setupApp and the client address', () => {
  let app: INestApplication<App>;
  const guessFrom = (address: string) =>
    request(app.getHttpServer()).post('/api/guess').set('X-Forwarded-For', address);

  afterEach(async () => {
    await app.close();
  });

  it('gives two forwarded addresses an allowance each when one proxy is trusted', async () => {
    app = await appTrusting(1);

    await guessFrom('203.0.113.1').expect(201);
    await guessFrom('203.0.113.1').expect(201);
    await guessFrom('203.0.113.1').expect(429);

    await guessFrom('203.0.113.2').expect(201);
  });

  it('takes the address the proxy added, not one the client put in front of it', async () => {
    app = await appTrusting(1);

    // nginx appends the address it saw to whatever the client sent.
    await guessFrom('198.51.100.7, 203.0.113.1').expect(201);
    await guessFrom('198.51.100.8, 203.0.113.1').expect(201);
    await guessFrom('198.51.100.9, 203.0.113.1').expect(429);
  });

  it('ignores the header when no proxy is trusted, so nobody picks an allowance by sending one', async () => {
    app = await appTrusting(0);

    await guessFrom('203.0.113.1').expect(201);
    await guessFrom('203.0.113.2').expect(201);
    await guessFrom('203.0.113.3').expect(429);
  });
});
