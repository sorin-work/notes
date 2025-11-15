import { Module } from '@nestjs/common';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';

@Module({
  imports: [NotebooksModule],
  controllers: [NotesController],
  providers: [NotesService],
  exports: [NotesService],
})
export class NotesModule {}
