import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { AuthModule } from '../auth/auth.module';
import { LinksModule } from '../links/links.module';
import { noStore } from './no-store.middleware';
import { SharePasswordAttempts } from './share-password-attempts';
import { NotebookSharesController, PublicSharesController, SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  // AuthService tells the public controller whether the reader is the owner.
  // LinksService finds the notes that the [[links]] of a shared note lead to.
  // AttachmentsService signs the addresses of a shared note's files.
  imports: [AuthModule, LinksModule, AttachmentsModule],
  controllers: [SharesController, NotebookSharesController, PublicSharesController],
  providers: [SharesService, SharePasswordAttempts],
})
export class SharesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStore).forRoutes(PublicSharesController);
  }
}
