import { AttachmentsModule } from '../attachments/attachments.module';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_CONFIG, AppConfig } from '../config/config';
import { MailModule } from '../mail/mail.module';
import { ApiTokensController } from './api-tokens.controller';
import { ApiTokensService } from './api-tokens.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordResetController } from './password-reset.controller';
import { PasswordResetService } from './password-reset.service';

@Module({
  imports: [
    AttachmentsModule,
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { expiresIn: config.jwtExpiresIn as `${number}d` },
      }),
    }),
    // One allowance a minute, the strict one, for whatever takes a password
    // or sends mail: sign-up, login, the account changes that ask for the
    // password again, and password reset. It is counted only where the
    // ThrottlerGuard is put. Anything with a limit of its own has a guard
    // of its own and no second entry here: every entry in this list is
    // counted by every ThrottlerGuard, and the lowest one wins. Requests
    // made with an API token are counted in the same store, per token
    // (ApiTokensService.throttle).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.authThrottleLimit }],
    }),
    MailModule,
  ],
  controllers: [AuthController, PasswordResetController, ApiTokensController],
  providers: [AuthService, PasswordResetService, ApiTokensService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  // For routes that are public but still want to know who is asking, such as a shared note read by its owner.
  exports: [AuthService],
})
export class AuthModule {}
