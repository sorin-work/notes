import { Module } from '@nestjs/common';
import { NotebooksModule } from '../notebooks/notebooks.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [NotebooksModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
