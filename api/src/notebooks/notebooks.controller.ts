import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { CreateNotebookDto, UpdateNotebookDto } from './dto/notebook.dto';
import { NotebooksService, NotebookView } from './notebooks.service';

@Controller('notebooks')
export class NotebooksController {
  constructor(private readonly notebooks: NotebooksService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<NotebookView[]> {
    return this.notebooks.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNotebookDto): Promise<NotebookView> {
    return this.notebooks.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotebookDto,
  ): Promise<NotebookView> {
    return this.notebooks.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notebooks.remove(user.id, id);
  }
}
