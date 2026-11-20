import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AccessService } from '../access/access.service';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import type { NoteView } from '../notes/note-view';
import { VersionsService, VersionSummary, VersionView } from './versions.service';

@AllowApiToken()
@Controller('notes/:noteId/versions')
export class VersionsController {
  constructor(
    private readonly versions: VersionsService,
    private readonly access: AccessService,
  ) {}

  /** Lists the earlier versions of a note. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Param('noteId', ParseUUIDPipe) noteId: string): Promise<VersionSummary[]> {
    const { ownerId } = await this.access.note(user.id, noteId, 'read');
    return this.versions.list(ownerId, noteId);
  }

  /** One earlier version with its text. */
  @Get(':versionId')
  async get(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<VersionView> {
    const { ownerId } = await this.access.note(user.id, noteId, 'read');
    return this.versions.get(ownerId, noteId, versionId);
  }

  /** Puts an earlier version back. The current text is saved as a version first. */
  @Post(':versionId/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<NoteView> {
    const granted = await this.access.note(user.id, noteId, 'edit');
    return {
      ...(await this.versions.restore(
        granted.ownerId,
        noteId,
        versionId,
        this.access.noteWriteGuard(user.id, noteId, 'edit'),
      )),
      access: granted.access,
    };
  }
}
