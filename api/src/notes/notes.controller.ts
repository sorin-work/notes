import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { AllowApiToken } from '../common/allow-api-token.decorator';
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import type { Page } from '../common/pagination';
import { Backlink, LinksService, OutgoingLink } from '../links/links.service';
import { ExportService } from '../transfer/export.service';
import {
  CreateNoteDto,
  DailyNoteDto,
  ListNotesQuery,
  RenameLinksDto,
  ResolveQuery,
  TitleQuery,
  UpdateNoteDto,
} from './dto/note.dto';
import type { NoteSummary, NoteView } from './note-view';
import { NotesService, RenamedLinks } from './notes.service';

@AllowApiToken()
@Controller('notes')
export class NotesController {
  constructor(
    private readonly notes: NotesService,
    private readonly links: LinksService,
    private readonly exporter: ExportService,
  ) {}

  /** Lists notes, pinned ones first. `notebookId=none` gives the notes that are in no notebook. */
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotesQuery): Promise<Page<NoteSummary>> {
    return this.notes.list(user.id, query);
  }

  /** Titles that start with or contain `q`, for link completion and the quick switcher. */
  @Get('titles')
  titles(@CurrentUser() user: AuthUser, @Query() query: TitleQuery): Promise<{ id: string; title: string }[]> {
    return this.notes.titles(user.id, query.q, query.limit);
  }

  /** Finds the note that a `[[title]]` link points at. */
  @Get('resolve')
  resolve(@CurrentUser() user: AuthUser, @Query() query: ResolveQuery): Promise<{ id: string; title: string }> {
    return this.links.resolve(user.id, query.title);
  }

  /** Creates a note. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoteDto): Promise<NoteView> {
    return this.notes.create(user.id, dto);
  }

  /**
   * The daily note of a day: opens the one there is and makes it when there
   * is none. Asked twice for the same day, it answers with the same note.
   */
  @Post('daily')
  @HttpCode(HttpStatus.OK)
  daily(@CurrentUser() user: AuthUser, @Body() dto: DailyNoteDto): Promise<NoteView> {
    return this.notes.daily(user.id, dto);
  }

  /** One note with its text. */
  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<NoteView> {
    return this.notes.get(user.id, id);
  }

  /** Makes a copy of a note: its text, tags and notebook, and nothing else of it. */
  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<NoteView> {
    return this.notes.duplicate(user.id, id);
  }

  /** Changes a note. The text it had before is kept as a version, at most every ten minutes. */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ): Promise<NoteView> {
    return this.notes.update(user.id, id, dto);
  }

  /** Moves a note to the trash. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  trash(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notes.trash(user.id, id);
  }

  /** The notes that link to this one, with the paragraph the link is in. */
  @Get(':id/backlinks')
  backlinks(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Backlink[]> {
    return this.links.backlinks(user.id, id);
  }

  /** The links in this note and the notes they lead to. */
  @Get(':id/links')
  outgoing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OutgoingLink[]> {
    return this.links.outgoing(user.id, id);
  }

  /** How many notes still link to `from`, the title this note had before it was renamed. */
  @Get(':id/rename-links')
  async orphanedLinks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RenameLinksDto,
  ): Promise<{ count: number }> {
    return { count: await this.notes.orphanedLinkCount(user.id, id, query.from) };
  }

  /** Rewrites those links to the title the note has now. */
  @Post(':id/rename-links')
  @HttpCode(HttpStatus.OK)
  renameLinks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameLinksDto,
  ): Promise<RenamedLinks> {
    return this.notes.renameLinks(user.id, id, dto.from);
  }

  /** Downloads one note as a Markdown file. */
  @Get(':id/export')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async export(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { filename, markdown } = await this.exporter.exportNote(user.id, id);
    return new StreamableFile(Buffer.from(markdown, 'utf8'), {
      disposition: `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }
}

export function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}
