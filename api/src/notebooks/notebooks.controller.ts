import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { CreateNotebookDto, UpdateNotebookDto } from './dto/notebook.dto';
import { NotebooksService, NotebookView } from './notebooks.service';

@AllowApiToken()
@Controller('notebooks')
export class NotebooksController {
  constructor(private readonly notebooks: NotebooksService) {}

  /** Lists the notebooks with their note counts: your own, then those shared with you (`access` is not `owner`). */
  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<NotebookView[]> {
    return [...(await this.notebooks.list(user.id)), ...(await this.notebooks.listShared(user.id))];
  }

  /** Creates a notebook, at the top level or inside a top-level one. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNotebookDto): Promise<NotebookView> {
    return this.notebooks.create(user.id, dto);
  }

  /** Renames or moves a notebook. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotebookDto,
  ): Promise<NotebookView> {
    return this.notebooks.update(user.id, id, dto);
  }

  /** Deletes a notebook. Its notes go to the trash. */
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<{ trashedNotes: number }> {
    return this.notebooks.remove(user.id, id);
  }
}
