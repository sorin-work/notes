import { PickType } from '@nestjs/swagger';
import { NoteFilterQuery } from '../../notes/dto/note.dto';

/**
 * The notebook and the tag to narrow the graph down to, with the rules they
 * have for the note list. Nothing else: the graph is not paged, it has a
 * limit of its own, and `page` or `pageSize` are refused like any field the
 * API does not know.
 */
export class GraphQuery extends PickType(NoteFilterQuery, ['notebookId', 'tag'] as const) {}
