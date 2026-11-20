import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { noStore } from './no-store.middleware';
import { SharePasswordAttempts } from './share-password-attempts';
import { PublicSharesController, SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  // AuthService tells the public controller whether the reader is the owner.
  imports: [AuthModule],
  controllers: [SharesController, PublicSharesController],
  providers: [SharesService, SharePasswordAttempts],
})
export class SharesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStore).forRoutes(PublicSharesController);
  }
}
