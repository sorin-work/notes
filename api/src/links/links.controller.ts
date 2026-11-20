import { Controller, Get, Query } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { NotebooksService } from '../notebooks/notebooks.service';
import { NoteFilterQuery } from '../notes/dto/note.dto';
import { normalizeTagName } from '../tags/tag-name';
import { Graph, LinksService } from './links.service';

/**
 * The notebook and tag filters of the note list. The graph is not paged, it
 * has a limit of its own: `page` and `pageSize` come along with the filters
 * and are ignored.
 */
export class GraphQuery extends NoteFilterQuery {}

@Controller('links')
export class LinksController {
  constructor(
    private readonly links: LinksService,
    private readonly notebooks: NotebooksService,
  ) {}

  /** The notes and the links between them, for the graph page. */
  @Get('graph')
  async graph(@CurrentUser() user: AuthUser, @Query() query: GraphQuery): Promise<Graph> {
    // A top-level notebook covers the notebooks inside it, as in the note list.
    const notebookIds =
      query.notebookId === undefined || query.notebookId === 'none'
        ? query.notebookId
        : await this.notebooks.idsWithChildren(user.id, query.notebookId);
    const tag = query.tag ? (normalizeTagName(query.tag) ?? query.tag) : undefined;
    return this.links.graph(user.id, { notebookIds, tag });
  }
}
