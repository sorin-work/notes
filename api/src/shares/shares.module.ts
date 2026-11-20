import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LinksModule } from '../links/links.module';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { noStore } from './no-store.middleware';
import { SharePasswordAttempts } from './share-password-attempts';
import { NotebookSharesController, PublicSharesController, SharesController } from './shares.controller';
import { SharesService } from './shares.service';

@Module({
  // AuthService tells the public controller whether the reader is the owner.
  // LinksService finds the notes that the [[links]] of a shared note lead to.
  // NotebooksService says which notebooks are inside a shared one.
  imports: [AuthModule, LinksModule, NotebooksModule],
  controllers: [SharesController, NotebookSharesController, PublicSharesController],
  providers: [SharesService, SharePasswordAttempts],
})
export class SharesModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(noStore).forRoutes(PublicSharesController);
  }
}
