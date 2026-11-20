import { Module } from '@nestjs/common';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { LinksController } from './links.controller';
import { LinksService } from './links.service';

@Module({
  imports: [NotebooksModule],
  controllers: [LinksController],
  providers: [LinksService],
  exports: [LinksService],
})
export class LinksModule {}
