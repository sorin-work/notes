import { Module } from '@nestjs/common';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';
import { ParsePool } from './parse-pool';

@Module({
  imports: [NotebooksModule],
  controllers: [LinksController],
  // One pool of parser workers for the app, shared by mentions and tasks.
  providers: [LinksService, ParsePool],
  exports: [LinksService, ParsePool],
})
export class LinksModule {}
