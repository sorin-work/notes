import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { InvitesController, MembersController } from './members.controller';
import { MembersService } from './members.service';
import { NotebooksController } from './notebooks.controller';
import { NotebooksService } from './notebooks.service';

@Module({
  imports: [MailModule],
  controllers: [NotebooksController, MembersController, InvitesController],
  providers: [NotebooksService, MembersService],
  exports: [NotebooksService],
})
export class NotebooksModule {}
