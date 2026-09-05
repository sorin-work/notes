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
import { AuthUser, CurrentUser } from '../common/current-user.decorator';
import type { Page } from '../common/pagination';
import { Backlink, LinksService, OutgoingLink } from '../links/links.service';
import { ExportService } from '../transfer/export.service';
import { CreateNoteDto, ListNotesQuery, ResolveQuery, TitleQuery, UpdateNoteDto } from './dto/note.dto';
import type { NoteSummary, NoteView } from './note-view';
import { NotesService } from './notes.service';

@Controller('notes')
export class NotesController {
  constructor(
    private readonly notes: NotesService,
    private readonly links: LinksService,
    private readonly exporter: ExportService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotesQuery): Promise<Page<NoteSummary>> {
    return this.notes.list(user.id, query);
  }

  @Get('titles')
  titles(@CurrentUser() user: AuthUser, @Query() query: TitleQuery): Promise<{ id: string; title: string }[]> {
    return this.notes.titles(user.id, query.q, query.limit);
  }

  @Get('resolve')
  resolve(@CurrentUser() user: AuthUser, @Query() query: ResolveQuery): Promise<{ id: string; title: string }> {
    return this.links.resolve(user.id, query.title);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateNoteDto): Promise<NoteView> {
    return this.notes.create(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<NoteView> {
    return this.notes.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNoteDto,
  ): Promise<NoteView> {
    return this.notes.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  trash(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notes.trash(user.id, id);
  }

  @Get(':id/backlinks')
  backlinks(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<Backlink[]> {
    return this.links.backlinks(user.id, id);
  }

  @Get(':id/links')
  outgoing(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OutgoingLink[]> {
    return this.links.outgoing(user.id, id);
  }

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
