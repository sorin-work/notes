import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AccessService } from '../access/access.service';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { NotebooksService } from '../notebooks/notebooks.service';
import { NoteView } from '../notes/note-view';
import { TasksQuery, TickTaskDto } from './dto/tasks.dto';
import { TaskList, TasksService } from './tasks.service';

@AllowApiToken()
@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly notebooks: NotebooksService,
    private readonly access: AccessService,
  ) {}

  /**
   * The open tasks across the notes, grouped by note, the note edited last
   * first. Your own notes, or with `notebookId` of a notebook shared with
   * you, the notes of that notebook and nothing else of its owner's.
   */
  @Get('tasks')
  async list(@CurrentUser() user: AuthUser, @Query() query: TasksQuery): Promise<TaskList & { canTick: boolean }> {
    const granted = await this.access.ownerForFilter(user.id, query.notebookId);
    // A notebook covers every notebook inside it, as in the note list.
    const notebookIds =
      query.notebookId === undefined || query.notebookId === 'none'
        ? query.notebookId
        : await this.notebooks.idsWithChildren(granted.ownerId, query.notebookId);
    const list = await this.tasks.list(user.id, granted.ownerId, { notebookIds, tag: query.tag });
    return { ...list, canTick: granted.access !== 'read' };
  }

  /**
   * Ticks the box on `line` of a note, or unticks it. Only while the note is
   * at `revision` and that line holds a box in the state `checked` says:
   * otherwise 409. Readers of a shared notebook may not.
   */
  @Post('notes/:noteId/tasks')
  @HttpCode(HttpStatus.OK)
  async tick(
    @CurrentUser() user: AuthUser,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: TickTaskDto,
  ): Promise<NoteView> {
    const granted = await this.access.note(user.id, noteId, 'edit');
    const guard = granted.access === 'owner' ? undefined : this.access.noteWriteGuard(user.id, noteId, 'edit');
    const view = await this.tasks.tick(granted.ownerId, noteId, dto, guard);
    return { ...view, access: granted.access };
  }
}
