import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { createSmtpTransport, MAIL_TRANSPORT, MailService } from './mail.service';

@Module({
  providers: [
    {
      provide: MAIL_TRANSPORT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => (config.mail ? createSmtpTransport(config.mail) : null),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
