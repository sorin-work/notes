import { AccessModule } from './access/access.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, DiscoveryModule } from '@nestjs/core';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { NotebooksModule } from './notebooks/notebooks.module';
import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';
import { SearchModule } from './search/search.module';
import { SeedModule } from './seed/seed.module';
import { SharesModule } from './shares/shares.module';
import { TagsModule } from './tags/tags.module';
import { TransferModule } from './transfer/transfer.module';
import { TrashModule } from './trash/trash.module';
import { VersionsModule } from './versions/versions.module';

@Module({
  imports: [
    ConfigModule,
    // For docs.ts, which walks the controllers to describe the API.
    DiscoveryModule,
    PrismaModule,
    AccessModule,
    AuthModule,
    NotebooksModule,
    NotesModule,
    AttachmentsModule,
    TagsModule,
    VersionsModule,
    TrashModule,
    SearchModule,
    SharesModule,
    TransferModule,
    SeedModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*path');
  }
}
