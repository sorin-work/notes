import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { NotebooksModule } from './notebooks/notebooks.module';
import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';
import { SearchModule } from './search/search.module';
import { SharesModule } from './shares/shares.module';
import { TagsModule } from './tags/tags.module';
import { TrashModule } from './trash/trash.module';
import { VersionsModule } from './versions/versions.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    NotebooksModule,
    NotesModule,
    TagsModule,
    VersionsModule,
    TrashModule,
    SearchModule,
    SharesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*path');
  }
}
