import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module';
import { ParsePool } from '../links/parse-pool';
import { VersionsModule } from '../versions/versions.module';
import { MentionsController } from './mentions.controller';
import { MentionsService } from './mentions.service';

@Module({
  imports: [LinksModule, VersionsModule],
  controllers: [MentionsController],
  providers: [MentionsService, ParsePool],
})
export class MentionsModule {}
