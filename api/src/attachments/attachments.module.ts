import { Module } from '@nestjs/common';
import { AttachmentsController, NoteAttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { AttachmentStorage } from './storage';

@Module({
  controllers: [NoteAttachmentsController, AttachmentsController],
  providers: [AttachmentsService, AttachmentStorage],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
