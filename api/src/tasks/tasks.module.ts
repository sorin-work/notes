import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { NotesModule } from '../notes/notes.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [LinksModule, NotebooksModule, NotesModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
