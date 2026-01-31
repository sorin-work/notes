import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import type { NoteView } from '../notes/note-view';
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

  @Post(':versionId/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<NoteView> {
    return this.versions.restore(user.id, noteId, versionId);
  }
}
