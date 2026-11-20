import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import type { NoteView } from '../notes/note-view';
import { VersionsService, VersionSummary, VersionView } from './versions.service';

@Controller('notes/:noteId/versions')
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  /** Lists the earlier versions of a note. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Param('noteId', ParseUUIDPipe) noteId: string): Promise<VersionSummary[]> {
    return this.versions.list(user.id, noteId);
  }

  /** One earlier version with its text. */
  @Get(':versionId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<VersionView> {
    return this.versions.get(user.id, noteId, versionId);
  }

  /** Puts an earlier version back. The current text is saved as a version first. */
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
