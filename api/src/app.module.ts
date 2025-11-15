import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { NotebooksModule } from './notebooks/notebooks.module';
import { NotesModule } from './notes/notes.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule, PrismaModule, AuthModule, NotebooksModule, NotesModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class AppModule {}
