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
      // Two allowances a minute, both counted wherever the ThrottlerGuard is
      // used. "default" is the strict one, for whatever takes a password.
      // "public" is the roomy one for reading shared notes, where the strict
      // one is switched off.
      useFactory: (config: AppConfig) => [
        { name: 'default', ttl: 60_000, limit: config.authThrottleLimit },
        { name: 'public', ttl: 60_000, limit: config.publicThrottleLimit },
      ],
    }),
    MailModule,
  ],
  controllers: [AuthController, PasswordResetController, ApiTokensController],
  providers: [AuthService, PasswordResetService, ApiTokensService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  // For routes that are public but still want to know who is asking, such as a shared note read by its owner.
  exports: [AuthService],
})
export class AuthModule {}
