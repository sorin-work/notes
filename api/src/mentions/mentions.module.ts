import { Module } from '@nestjs/common';
import { LinksModule } from '../links/links.module';
import { VersionsModule } from '../versions/versions.module';
import { MentionsController } from './mentions.controller';
import { MentionsService } from './mentions.service';

@Module({
  imports: [LinksModule, VersionsModule],
  controllers: [MentionsController],
  providers: [MentionsService],
})
export class MentionsModule {}
