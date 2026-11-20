import { Controller, Get, Query } from '@nestjs/common';
import { AccessService } from '../access/access.service';
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
    private readonly access: AccessService,
  ) {}

  /** The notes and the links between them, for the graph page. At most 300 notes, the ones edited last. */
  @Get('graph')
  async graph(@CurrentUser() user: AuthUser, @Query() query: GraphQuery): Promise<Graph> {
    // Your own notes, or with `notebookId` of a notebook shared with you, the
    // notes of that notebook and nothing else of its owner's.
    const granted = await this.access.ownerForFilter(user.id, query.notebookId);
    const visible = await this.access.visibleNotebookIds(user.id, granted.ownerId);
    // A notebook covers every notebook inside it, as in the note list.
    const notebookIds =
      query.notebookId === undefined || query.notebookId === 'none'
        ? query.notebookId
        : await this.notebooks.idsWithChildren(granted.ownerId, query.notebookId);
    const tag = query.tag ? (normalizeTagName(query.tag) ?? query.tag) : undefined;
    return this.links.graph(granted.ownerId, { notebookIds, tag, within: visible ? [...visible] : undefined });
  }
}
