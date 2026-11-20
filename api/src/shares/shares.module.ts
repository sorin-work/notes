import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ShareLinkThrottlerGuard } from './share-link-throttler.guard';
import { PublicSharesController, SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  // AuthService tells the public controller whether the reader is the owner.
  imports: [AuthModule],
  controllers: [SharesController, PublicSharesController],
  providers: [SharesService, ShareLinkThrottlerGuard],
})
export class SharesModule {}
