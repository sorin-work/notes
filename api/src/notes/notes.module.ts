import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { TagsModule } from '../tags/tags.module';
import { TransferModule } from '../transfer/transfer.module';
import { VersionsModule } from '../versions/versions.module';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { BulkService } from './bulk.service';

@Module({
  imports: [NotebooksModule, TagsModule, LinksModule, VersionsModule, TransferModule],
  controllers: [NotesController],
  providers: [NotesService, BulkService],
  exports: [NotesService],
})
export class NotesModule {}
