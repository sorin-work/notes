import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LinksModule } from '../links/links.module';
import { ShareLinkThrottlerGuard } from './share-link-throttler.guard';
import { NotebookSharesController, PublicSharesController, SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  // AuthService tells the public controller whether the reader is the owner.
  // LinksService finds the notes that the [[links]] of a shared note lead to.
  imports: [AuthModule, LinksModule],
  controllers: [SharesController, NotebookSharesController, PublicSharesController],
  providers: [SharesService, ShareLinkThrottlerGuard],
})
export class SharesModule {}
