import { Controller, Get, Query } from '@nestjs/common';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import { NotebooksService } from '../notebooks/notebooks.service';
import { normalizeTagName } from '../tags/tag-name';
import { GraphQuery } from './dto/graph.dto';
import { Graph, LinksService } from './links.service';

@AllowApiToken()
@Controller('links')
export class LinksController {
  constructor(
    private readonly links: LinksService,
    private readonly notebooks: NotebooksService,
  ) {}

  /** The notes and the links between them, for the graph page. At most 300 notes, the ones edited last. */
  @Get('graph')
  async graph(@CurrentUser() user: AuthUser, @Query() query: GraphQuery): Promise<Graph> {
    // A notebook covers every notebook inside it, as in the note list.
    const notebookIds =
      query.notebookId === undefined || query.notebookId === 'none'
        ? query.notebookId
        : await this.notebooks.idsWithChildren(user.id, query.notebookId);
    const tag = query.tag ? (normalizeTagName(query.tag) ?? query.tag) : undefined;
    return this.links.graph(user.id, { notebookIds, tag });
  }
}
