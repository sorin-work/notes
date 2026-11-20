import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Note, Prisma } from '@prisma/client';
import { Page, skipFor } from '../common/pagination';
import { LinksService } from '../links/links.service';
import { isLinkable, normalizeTitle, renameLinks } from '../links/wikilinks';
import { NotebooksService } from '../notebooks/notebooks.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTagName } from '../tags/tag-name';
import { TagsService } from '../tags/tags.service';
import { VersionsService } from '../versions/versions.service';
import { CreateNoteDto, ListNotesQuery, MAX_CONTENT_LENGTH, UpdateNoteDto } from './dto/note.dto';
import { IN_TRASH, refusedWrite, writeNoteText } from './note-text';
import { noteInclude, NoteSummary, NoteView, toSummary, toView } from './note-view';

export const DEFAULT_TITLE = 'Untitled';

export interface RenamedLinks {
  /** How many notes had their links rewritten. */
  updated: number;
  /** The title the links point at now. */
  title: string;
}

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notebooks: NotebooksService,
    private readonly tags: TagsService,
    private readonly links: LinksService,
    private readonly versions: VersionsService,
  ) {}

  async list(userId: string, query: ListNotesQuery): Promise<Page<NoteSummary>> {
    const where: Prisma.NoteWhereInput = { userId, deletedAt: null };

    if (query.notebookId === 'none') {
      where.notebookId = null;
    } else if (query.notebookId) {
      // A top-level notebook shows the notes of the notebooks inside it too.
      where.notebookId = { in: await this.notebooks.idsWithChildren(userId, query.notebookId) };
    }
    if (query.tag) {
      where.tags = { some: { tag: { name: normalizeTagName(query.tag) ?? query.tag } } };
    }
    if (query.pinned !== undefined) where.pinned = query.pinned;
    if (query.favorite !== undefined) where.favorite = query.favorite;

    const order = query.order ?? (query.sort === 'title' ? 'asc' : 'desc');
    const sortField = { updated: 'updatedAt', created: 'createdAt', title: 'title' } as const;
    const orderBy: Prisma.NoteOrderByWithRelationInput[] = [
      // Pinned notes stay at the top whatever the sort.
      { pinned: 'desc' },
      { [sortField[query.sort]]: order },
      { id: 'asc' },
    ];

    const [notes, total] = await this.prisma.$transaction([
      this.prisma.note.findMany({
        where,
        orderBy,
        skip: skipFor(query),
        take: query.pageSize,
        include: noteInclude,
      }),
      this.prisma.note.count({ where }),
    ]);
    return { items: notes.map(toSummary), total, page: query.page, pageSize: query.pageSize };
  }

  async get(userId: string, id: string): Promise<NoteView> {
    const note = await this.prisma.note.findFirst({ where: { id, userId }, include: noteInclude });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return toView(note);
  }

  async create(userId: string, dto: CreateNoteDto): Promise<NoteView> {
    if (dto.notebookId) {
      await this.notebooks.findOwned(userId, dto.notebookId);
    }
    const content = dto.content ?? '';
    const note = await this.prisma.$transaction(async (tx) => {
      const created = await tx.note.create({
        data: {
          userId,
          title: dto.title || DEFAULT_TITLE,
          content,
          notebookId: dto.notebookId ?? null,
          pinned: dto.pinned ?? false,
          favorite: dto.favorite ?? false,
        },
      });
      if (dto.tags?.length) {
        await this.tags.setNoteTags(tx, userId, created.id, dto.tags);
      }
      if (content) {
        await this.links.sync(tx, created.id, content);
      }
      return tx.note.findUniqueOrThrow({ where: { id: created.id }, include: noteInclude });
    });
    return toView(note);
  }

  async update(userId: string, id: string, dto: UpdateNoteDto): Promise<NoteView> {
    const note = await this.findActive(userId, id);
    if (dto.notebookId) {
      await this.notebooks.findOwned(userId, dto.notebookId);
    }

    // Only a save of the title or the content can be out of date. Pinning,
    // tags and moving a note are sent without them, and must not get in the
    // way of what is being typed in the same tab.
    const savesText = dto.title !== undefined || dto.content !== undefined;
    if (savesText && dto.revision !== undefined && dto.revision !== note.revision) {
      throw await refusedWrite(this.prisma, userId, id);
    }
    const title = dto.title === undefined ? note.title : dto.title || DEFAULT_TITLE;
    const content = dto.content ?? note.content;
    const textChanged = title !== note.title || content !== note.content;
    const notebookChanged = dto.notebookId !== undefined && dto.notebookId !== note.notebookId;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (savesText) {
        // The first statement, and the one that decides: it only writes while
        // the note is still at the revision the save names. A save that
        // raced this one and got in first makes this one fail here, with
        // nothing else changed. From here on `note` is known to be the state
        // this save replaces.
        const written = await writeNoteText(tx, { id, userId, revision: dto.revision }, { title, content });
        if (!written) throw await refusedWrite(tx, userId, id);
      }
      let tagsChanged = false;
      if (dto.tags !== undefined) {
        const before = (await tx.noteTag.findMany({ where: { noteId: id }, include: { tag: true } }))
          .map((noteTag) => noteTag.tag.name)
          .sort();
        const after = (await this.tags.setNoteTags(tx, userId, id, dto.tags)).sort();
        tagsChanged = before.join('\n') !== after.join('\n');
      }
      if (textChanged) {
        await (dto.keepVersion ? this.versions.snapshot(tx, note) : this.versions.snapshotIfDue(tx, note));
      }
      if (content !== note.content) {
        await this.links.sync(tx, id, content);
      }

      const data: Prisma.NoteUpdateInput = {};
      if (dto.notebookId !== undefined) {
        data.notebook = dto.notebookId ? { connect: { id: dto.notebookId } } : { disconnect: true };
      }
      if (dto.pinned !== undefined) data.pinned = dto.pinned;
      if (dto.favorite !== undefined) data.favorite = dto.favorite;
      // Pinning or favouriting is not an edit.
      if (textChanged || notebookChanged || tagsChanged) data.updatedAt = new Date();

      return tx.note.update({ where: { id }, data, include: noteInclude });
    });
    return toView(updated);
  }

  /**
   * How many notes link to `from`, a title this note had before it was
   * renamed, with links that lead nowhere now. It is the number of notes
   * renameLinks would rewrite.
   */
  async orphanedLinkCount(userId: string, id: string, from: string): Promise<number> {
    const note = await this.findActive(userId, id);
    return (await this.linkRewrites(this.prisma, userId, note, from)).length;
  }

  /**
   * Points the [[links]] that the user's other notes have to `from` at the
   * title this note has now. Nothing is rewritten while a note is still
   * called `from`, because the links are not dangling then.
   *
   * It all happens in one transaction, so either every note is rewritten or
   * none is. Each rewritten note gets a version of its old text first, which
   * makes the rewrite undoable from its history, and keeps its updatedAt, so
   * a rename does not reshuffle the "last edited" lists.
   */
  async renameLinks(userId: string, id: string, from: string): Promise<RenamedLinks> {
    const note = await this.findActive(userId, id);
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const now = new Date();
        let count = 0;
        for (const { source, content } of await this.linkRewrites(tx, userId, note, from)) {
          // Tied to the revision that was read: a note that was edited or
          // trashed since then is left alone, not overwritten.
          const written = await writeNoteText(tx, { id: source.id, userId, revision: source.revision }, { content });
          if (!written) continue;
          await this.versions.snapshot(tx, source, now);
          await this.links.sync(tx, source.id, content);
          count++;
        }
        return count;
      },
      { timeout: 30_000 },
    );
    return { updated, title: note.title };
  }

  /** Moves the note to the trash. */
  async trash(userId: string, id: string): Promise<void> {
    await this.findActive(userId, id);
    await this.prisma.note.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Titles starting with (or else containing) `q`, for [[link]] completion. */
  async titles(userId: string, q = '', limit = 10): Promise<{ id: string; title: string }[]> {
    const take = Math.min(Math.max(limit, 1), 25);
    const term = q.trim();
    const select = { id: true, title: true } as const;
    const base: Prisma.NoteWhereInput = { userId, deletedAt: null };
    if (!term) {
      return this.prisma.note.findMany({ where: base, orderBy: { updatedAt: 'desc' }, take, select });
    }
    const prefixed = await this.prisma.note.findMany({
      where: { ...base, title: { startsWith: term, mode: 'insensitive' } },
      orderBy: { title: 'asc' },
      take,
      select,
    });
    if (prefixed.length >= take) return prefixed;
    const containing = await this.prisma.note.findMany({
      where: {
        ...base,
        title: { contains: term, mode: 'insensitive' },
        id: { notIn: prefixed.map((note) => note.id) },
      },
      orderBy: { title: 'asc' },
      take: take - prefixed.length,
      select,
    });
    return [...prefixed, ...containing];
  }

  /**
   * The user's notes outside the trash, other than `note`, whose links to
   * `from` lead nowhere, each with its text once those links point at the
   * title `note` has now.
   */
  private async linkRewrites(
    db: Prisma.TransactionClient,
    userId: string,
    note: Note,
    from: string,
  ): Promise<{ source: Note; content: string }[]> {
    // Links lead nowhere only while no note is called `from`. That covers
    // this note too: changing the case of its title orphans nothing.
    if (!isLinkable(note.title) || (await this.links.titleTaken(userId, from, db))) {
      return [];
    }
    const sources = await db.note.findMany({
      where: {
        userId,
        deletedAt: null,
        id: { not: note.id },
        outgoingLinks: { some: { targetKey: normalizeTitle(from) } },
      },
      orderBy: { id: 'asc' },
    });
    return (
      sources
        .map((source) => ({ source, content: renameLinks(source.content, from, note.title) }))
        // A longer title must not push a note past the size the editor can save.
        .filter(({ source, content }) => content !== source.content && content.length <= MAX_CONTENT_LENGTH)
    );
  }

  /** A note that is not in the trash. Trashed notes are read-only. */
  async findActive(userId: string, id: string): Promise<Note> {
    const note = await this.prisma.note.findFirst({ where: { id, userId } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    if (note.deletedAt) {
      throw new ConflictException(IN_TRASH);
    }
    return note;
  }
}
