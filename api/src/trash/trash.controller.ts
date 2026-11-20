import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { TrashedNote, TrashService } from './trash.service';

@AllowApiToken()
@Controller('trash')
export class TrashController {
  constructor(private readonly trash: TrashService) {}

  /** Lists the notes in the trash. */
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<TrashedNote[]> {
    return this.trash.list(user.id);
  }

  /** Takes a note out of the trash. */
  @Post(':id/restore')
  @HttpCode(HttpStatus.NO_CONTENT)
  restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.trash.restore(user.id, id);
  }

  /** Deletes a note in the trash for good. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePermanently(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.trash.deletePermanently(user.id, id);
  }

  /** Empties the trash. */
  @Delete()
  empty(@CurrentUser() user: AuthUser): Promise<{ deleted: number }> {
    return this.trash.empty(user.id);
  }
}
