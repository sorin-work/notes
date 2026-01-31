import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { VersionsService, VersionSummary, VersionView } from './versions.service';

@Controller('notes/:noteId/versions')
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('noteId', ParseUUIDPipe) noteId: string): Promise<VersionSummary[]> {
    return this.versions.list(user.id, noteId);
  }

  @Get(':versionId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<VersionView> {
    return this.versions.get(user.id, noteId, versionId);
  }
}
