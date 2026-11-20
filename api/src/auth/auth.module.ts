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
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.jwtSecret,
        signOptions: { expiresIn: config.jwtExpiresIn as `${number}d` },
      }),
    }),
    // Only the routes that take a password or send mail use the
    // ThrottlerGuard: sign-up, login, the account changes that ask for the
    // password again, and password reset. Requests made with an API token
    // are counted in the same store, per token (ApiTokensService.throttle).
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => [{ ttl: 60_000, limit: config.authThrottleLimit }],
    }),
    MailModule,
  ],
  controllers: [AuthController, PasswordResetController, ApiTokensController],
  providers: [AuthService, PasswordResetService, ApiTokensService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AuthModule {}
