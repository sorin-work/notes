import { PickType } from '@nestjs/swagger';
import { IsBoolean, IsInt, Max, Min } from 'class-validator';
import { MAX_CONTENT_LENGTH, MAX_REVISION, NoteFilterQuery } from '../../notes/dto/note.dto';

/** The notebook and the tag to narrow the tasks down to, with the rules they have for the note list. Not paged. */
export class TasksQuery extends PickType(NoteFilterQuery, ['notebookId', 'tag'] as const) {}

/** Which box to tick or untick: the three values the Tasks page has for it. */
export class TickTaskDto {
  /** The line the task item starts on, counted from 1. */
  @IsInt()
  @Min(1)
  @Max(MAX_CONTENT_LENGTH)
  line: number;

  /** Whether the box showed as ticked when it was clicked. The line has to hold a box in that state. */
  @IsBoolean()
  checked: boolean;

  /** The revision of the note that the task was read from. */
  @IsInt()
  @Min(0)
  @Max(MAX_REVISION)
  revision: number;
}
