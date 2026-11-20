import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
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
import { AccessService, Granted } from '../access/access.service';
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
    private readonly access: AccessService,
  ) {}

  /** The notebooks a member may see of the owner: what their links, titles and backlinks are kept to. */
  private async within(userId: string, granted: Granted): Promise<string[] | undefined> {
    const visible = await this.access.visibleNotebookIds(userId, granted.ownerId);
    return visible ? [...visible] : undefined;
  }

  private withAccess(view: NoteView, granted: Granted): NoteView {
    return { ...view, access: granted.access };
  }

  /** Lists notes, pinned ones first. `notebookId=none` gives the notes that are in no notebook. */
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListNotesQuery): Promise<Page<NoteSummary>> {
    // A notebook shared with the caller lists its owner's notes there. Never its templates.
    const granted = await this.access.ownerForFilter(user.id, query.notebookId);
    if (granted.access !== 'owner') query.templates = false;
    return this.notes.list(granted.ownerId, query);
  }

  /** Titles that start with or contain `q`, for link completion and the quick switcher. */
  @Get('titles')
  async titles(@CurrentUser() user: AuthUser, @Query() query: TitleQuery): Promise<{ id: string; title: string }[]> {
    const granted = await this.access.ownerForFilter(user.id, query.notebookId);
    return this.notes.titles(granted.ownerId, query.q, query.limit, await this.within(user.id, granted));
  }

  /** Finds the note that a `[[title]]` link points at. */
  @Get('resolve')
  async resolve(@CurrentUser() user: AuthUser, @Query() query: ResolveQuery): Promise<{ id: string; title: string }> {
    const granted = await this.access.ownerForFilter(user.id, query.notebookId);
    return this.links.resolve(granted.ownerId, query.title, await this.within(user.id, granted));
  }

  /** Creates a note. */
  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoteDto): Promise<NoteView> {
    if (!dto.notebookId) return this.notes.create(user.id, dto);
    const granted = await this.access.notebook(user.id, dto.notebookId, 'edit');
    if (granted.access === 'owner') return this.notes.create(user.id, dto);
    // A member adds a note to the owner's notebook: the owner's note, with the owner's tags.
    // Templates, pins and stars belong to the owner and are not the member's to set.
    if (dto.templateId || dto.isTemplate || dto.pinned || dto.favorite) {
      throw new ForbiddenException(
        'In a notebook shared with you, a new note can only be given a title, text and tags.',
      );
    }
    return this.withAccess(await this.notes.create(granted.ownerId, dto), granted);
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
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<NoteView> {
    const granted = await this.access.note(user.id, id, 'read');
    return this.withAccess(await this.notes.get(granted.ownerId, id), granted);
  }

  /**
   * Takes a daily note off its day. It stays an ordinary note, the next
   * `POST /notes/daily` for that day makes a new one, and its title no longer
   * makes it the note of a day.
   */
  @Delete(':id/daily')
  async releaseDaily(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<NoteView> {
    await this.access.note(user.id, id, 'owner');
    return this.notes.releaseDaily(user.id, id);
  }

  /** Makes a copy of a note: its text, tags and notebook, and nothing else of it. */
  @Post(':id/duplicate')
  async duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<NoteView> {
    await this.access.note(user.id, id, 'owner');
    return this.notes.duplicate(user.id, id);
  }

  /** Changes a note. The text it had before is kept as a version, at most every ten minutes. */
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ): Promise<NoteView> {
    const granted = await this.access.note(user.id, id, 'edit');
    if (granted.access !== 'owner') {
      // A member changes the text and the tags. Where the note lives and how the owner keeps it is the owner's.
      const ownerOnly = (['notebookId', 'pinned', 'favorite', 'isTemplate'] as const).filter(
        (key) => dto[key] !== undefined,
      );
      if (ownerOnly.length > 0) {
        throw new ForbiddenException(`Only the owner of the notebook can change ${ownerOnly.join(', ')}.`);
      }
    }
    return this.withAccess(await this.notes.update(granted.ownerId, id, dto), granted);
  }

  /** Moves a note to the trash. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trash(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.access.note(user.id, id, 'owner');
    return this.notes.trash(user.id, id);
  }

  /** The notes that link to this one, with the paragraph the link is in. */
  @Get(':id/backlinks')
  async backlinks(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Backlink[]> {
    const granted = await this.access.note(user.id, id, 'read');
    return this.links.backlinks(granted.ownerId, id, await this.within(user.id, granted));
  }

  /** The links in this note and the notes they lead to. */
  @Get(':id/links')
  async outgoing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OutgoingLink[]> {
    const granted = await this.access.note(user.id, id, 'read');
    return this.links.outgoing(granted.ownerId, id, await this.within(user.id, granted));
  }

  /** How many notes still link to `from`, the title this note had before it was renamed. */
  @Get(':id/rename-links')
  async orphanedLinks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: RenameLinksDto,
  ): Promise<{ count: number }> {
    // Renaming rewrites the owner's other notes, so it is the owner's to do.
    await this.access.note(user.id, id, 'owner');
    return { count: await this.notes.orphanedLinkCount(user.id, id, query.from) };
  }

  /** Rewrites those links to the title the note has now. */
  @Post(':id/rename-links')
  @HttpCode(HttpStatus.OK)
  async renameLinks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameLinksDto,
  ): Promise<RenamedLinks> {
    await this.access.note(user.id, id, 'owner');
    return this.notes.renameLinks(user.id, id, dto.from);
  }

  /** Downloads one note as a Markdown file. */
  @Get(':id/export')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async export(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const granted = await this.access.note(user.id, id, 'read');
    const { filename, markdown } = await this.exporter.exportNote(granted.ownerId, id);
    return new StreamableFile(Buffer.from(markdown, 'utf8'), {
      disposition: `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }
}

export function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
}
