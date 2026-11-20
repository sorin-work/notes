import { ConflictException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AttachmentsService, StoredFile } from '../attachments/attachments.service';
import { RESTORE_TIMEOUT_MS } from '../attachments/timing';
import { LinksService } from '../links/links.service';
import { PrismaService } from '../prisma/prisma.service';
import { readPreferences } from '../auth/preferences';
import {
  BackupAttachment,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupNote,
  BackupNotebook,
  BackupShareLink,
  BackupTag,
} from './backup';
import { replaceAttachmentLinks } from './attachment-links';
import { invalid } from './backup-check';
import { readBackupStream } from './backup-stream';

/** Notes read from the database at a time while the backup is written out. */
const BATCH = 200;
/** A batch of restored notes is written once it holds this much text, even with fewer than BATCH notes. */
const RESTORE_BATCH_CHARS = 20_000_000;

export interface RestoreResult {
  notes: number;
  notebooks: number;
  tags: number;
  versions: number;
  attachments: number;
  /** Share links in the file. They are not made again: see the README. */
  shareLinksNotRestored: number;
}

const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null) => (date ? date.toISOString() : null);

const backupNoteInclude = {
  tags: { select: { tag: { select: { name: true } } }, orderBy: { tag: { name: 'asc' } } },
  versions: { select: { title: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.NoteInclude;

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
    private readonly attachments: AttachmentsService,
  ) {}

  /**
   * The account's backup as JSON, in pieces. The small lists come first and
   * the notes one by one after them, read from the database a batch at a
   * time, so the API never holds the whole file. The web app downloads it
   * through a one-time link (POST /export/backup/link) that the browser
   * follows itself, so the browser saves it to disk as it comes in too.
   */
  async *write(userId: string, now = new Date()): AsyncGenerator<string> {
    const [user, notebooks, tags, shareLinks] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } }),
      this.prisma.notebook.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.tag.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      this.prisma.shareLink.findMany({
        where: { OR: [{ note: { userId } }, { notebook: { userId } }] },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    // Parents before the notebooks inside them, so a reader can make them in order.
    notebooks.sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));

    const head = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: iso(now),
      preferences: readPreferences(user.preferences),
      notebooks: notebooks.map((notebook): BackupNotebook => ({
        id: notebook.id,
        name: notebook.name,
        parentId: notebook.parentId,
        createdAt: iso(notebook.createdAt),
        updatedAt: iso(notebook.updatedAt),
      })),
      tags: tags.map((tag): BackupTag => ({ name: tag.name, createdAt: iso(tag.createdAt) })),
      // No token and no password hash: the file must not open the shares for whoever holds it.
      shareLinks: shareLinks.map((link): BackupShareLink => ({
        noteId: link.noteId,
        notebookId: link.notebookId,
        hasPassword: link.passwordHash !== null,
        expiresAt: isoOrNull(link.expiresAt),
        viewCount: link.viewCount,
        createdAt: iso(link.createdAt),
      })),
    };
    const opening = JSON.stringify(head);
    yield `${opening.slice(0, -1)},"attachments":[`;

    // The files, one at a time, the notes in the trash included.
    const files = await this.prisma.attachment.findMany({
      where: { userId, note: { userId } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, noteId: true, fileName: true, createdAt: true },
    });
    // A file that is gone from storage is left out, and named in missingAttachments.
    const missing: string[] = [];
    let written = 0;
    for (const file of files) {
      let bytes: Buffer;
      try {
        bytes = await this.attachments.read(file.id);
      } catch {
        missing.push(file.id);
        continue;
      }
      const entry: BackupAttachment = {
        id: file.id,
        noteId: file.noteId,
        fileName: file.fileName,
        createdAt: iso(file.createdAt),
        data: bytes.toString('base64'),
      };
      yield `${written === 0 ? '' : ','}\n${JSON.stringify(entry)}`;
      written++;
    }
    if (missing.length > 0) {
      this.logger.warn(`Backup left out ${missing.length} attachment file(s) that are missing from storage`);
    }
    yield `\n],"missingAttachments":${JSON.stringify(missing)},"notes":[`;

    let after: string | undefined;
    let first = true;
    for (;;) {
      const batch = await this.prisma.note.findMany({
        where: { userId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: BATCH,
        include: backupNoteInclude,
      });
      for (const note of batch) {
        const entry: BackupNote = {
          id: note.id,
          title: note.title,
          content: note.content,
          notebookId: note.notebookId,
          tags: note.tags.map((noteTag) => noteTag.tag.name),
          pinned: note.pinned,
          favorite: note.favorite,
          isTemplate: note.isTemplate,
          dailyDate: note.dailyDate ? note.dailyDate.toISOString().slice(0, 10) : null,
          dailyReleased: note.dailyReleased,
          revision: note.revision,
          createdAt: iso(note.createdAt),
          updatedAt: iso(note.updatedAt),
          deletedAt: isoOrNull(note.deletedAt),
          versions: note.versions.map((version) => ({
            title: version.title,
            content: version.content,
            createdAt: iso(version.createdAt),
          })),
        };
        yield `${first ? '' : ','}\n${JSON.stringify(entry)}`;
        first = false;
      }
      if (batch.length < BATCH) break;
      after = batch[batch.length - 1].id;
    }
    yield '\n]}\n';
  }

  /**
   * Puts a backup into an account that has nothing in it yet: the notes with
   * their history, revisions, tags and trash, and the notebooks they were in.
   * Everything gets new ids. The file is read from `source` as it comes in,
   * checked part by part, and written in batches, all in one transaction, so
   * a restore that fails at any point leaves the account as empty as it was.
   * However large the backup, only one batch of notes is in memory at a time.
   *
   * Share links are not made again. The file holds no tokens, so a new link
   * would have a new address, and no password hashes, so a link that had a
   * password would come back open. The owner shares again where they want to.
   */
  async restore(userId: string, source: Readable): Promise<RestoreResult> {
    // Files are written as they are read, before their rows. Should the restore fail, they go again.
    const written: string[] = [];
    return this.prisma
      .$transaction(
        async (tx) => {
          // The user row is locked, so that two restores at once cannot both find the account empty.
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
          const [notes, notebooks, tags] = await Promise.all([
            tx.note.count({ where: { userId } }),
            tx.notebook.count({ where: { userId } }),
            tx.tag.count({ where: { userId } }),
          ]);
          if (notes + notebooks + tags > 0) {
            throw new ConflictException(
              'A backup is restored into an empty account. This one has notes, notebooks or tags already.',
            );
          }

          const notebookIds = new Map<string, string>();
          const noteIds = new Map<string, string>();
          const tagIds = new Map<string, string>();
          let notebookCount = 0;
          let versions = 0;
          let pending: BackupNote[] = [];

          const ensureTags = async (names: Iterable<string>, createdAt = new Date()) => {
            const missing = [...new Set(names)].filter((name) => !tagIds.has(name));
            if (missing.length === 0) return;
            await tx.tag.createMany({
              data: missing.map((name) => ({ userId, name, createdAt })),
              skipDuplicates: true,
            });
            const rows = await tx.tag.findMany({
              where: { userId, name: { in: missing } },
              select: { id: true, name: true },
            });
            for (const row of rows) tagIds.set(row.name, row.id);
          };

          /** Attachments by their id in the file: the stored file and the note it belongs to, also by its id in the file. */
          const files = new Map<string, { stored: StoredFile; noteId: string }>();
          let fileBytes = 0;
          const newFileId = (old: string) => {
            const id = files.get(old)?.stored.id;
            return id && `attachment:${id}`;
          };

          const flush = async () => {
            if (pending.length === 0) return;
            const batch = pending;
            pending = [];
            await ensureTags(batch.flatMap((note) => note.tags));
            for (const note of batch) {
              noteIds.set(note.id, randomUUID());
              // The links to attachments get the attachments' new ids.
              note.content = replaceAttachmentLinks(note.content, newFileId);
              for (const version of note.versions) version.content = replaceAttachmentLinks(version.content, newFileId);
            }
            await tx.note.createMany({
              data: batch.map((note) => ({
                id: noteIds.get(note.id) as string,
                userId,
                notebookId: note.notebookId === null ? null : (notebookIds.get(note.notebookId) as string),
                title: note.title,
                content: note.content,
                pinned: note.pinned,
                favorite: note.favorite,
                isTemplate: note.isTemplate,
                dailyDate: note.dailyDate === null ? null : new Date(`${note.dailyDate}T00:00:00Z`),
                dailyReleased: note.dailyReleased,
                revision: note.revision,
                createdAt: new Date(note.createdAt),
                updatedAt: new Date(note.updatedAt),
                deletedAt: note.deletedAt === null ? null : new Date(note.deletedAt),
              })),
            });
            const noteTags = batch.flatMap((note) =>
              note.tags.map((name) => ({ noteId: noteIds.get(note.id) as string, tagId: tagIds.get(name) as string })),
            );
            if (noteTags.length > 0) await tx.noteTag.createMany({ data: noteTags });
            const history = batch.flatMap((note) =>
              note.versions.map((version) => ({
                noteId: noteIds.get(note.id) as string,
                title: version.title,
                content: version.content,
                createdAt: new Date(version.createdAt),
              })),
            );
            if (history.length > 0) await tx.noteVersion.createMany({ data: history });
            versions += history.length;
            const rows = batch.flatMap((note) =>
              [...files.values()]
                .filter((file) => file.noteId === note.id)
                .map((file) => ({ ...file.stored, userId, noteId: noteIds.get(note.id) as string })),
            );
            if (rows.length > 0) await tx.attachment.createMany({ data: rows });
            attachmentCount += rows.length;
            for (const note of batch) {
              if (note.content) await this.links.sync(tx, noteIds.get(note.id) as string, note.content);
            }
          };
          let attachmentCount = 0;

          const summary = await readBackupStream(source, {
            notebooks: async (list) => {
              for (const notebook of list) notebookIds.set(notebook.id, randomUUID());
              // Parents first, so the foreign key on parent_id is satisfied.
              for (const nested of [false, true]) {
                const level = list.filter((notebook) => (notebook.parentId !== null) === nested);
                if (level.length === 0) continue;
                await tx.notebook.createMany({
                  data: level.map((notebook) => ({
                    id: notebookIds.get(notebook.id) as string,
                    userId,
                    name: notebook.name,
                    parentId: notebook.parentId === null ? null : (notebookIds.get(notebook.parentId) as string),
                    createdAt: new Date(notebook.createdAt),
                    updatedAt: new Date(notebook.updatedAt),
                  })),
                });
              }
              notebookCount = list.length;
            },
            tags: async (list) => {
              for (const tag of list) await ensureTags([tag.name], new Date(tag.createdAt));
            },
            attachment: async (attachment) => {
              if (files.has(attachment.id)) invalid('attachments', 'has two with the same id');
              const bytes = Buffer.from(attachment.data, 'base64');
              fileBytes += bytes.length;
              if (fileBytes > this.attachments.accountBytes) {
                throw new PayloadTooLargeException('The attachments in this backup go past what an account may hold');
              }
              const stored = await this.attachments.store(attachment.fileName, bytes);
              if (!stored) invalid(`attachments[${files.size}]`, 'is not a file this app attaches, or too large');
              written.push(stored.id);
              files.set(attachment.id, {
                stored: { ...stored, createdAt: new Date(attachment.createdAt) },
                noteId: attachment.noteId,
              });
            },
            note: async (note) => {
              pending.push(note);
              // A batch by count, or sooner when its text is large, so memory stays bounded.
              const size = pending.reduce((sum, item) => sum + item.content.length, 0);
              if (pending.length >= BATCH || size > RESTORE_BATCH_CHARS) await flush();
            },
          });
          await flush();

          // The daily note choices, pointing at the new notebook and template.
          const daily = summary.preferences.dailyNotes;
          await tx.user.update({
            where: { id: userId },
            data: {
              preferences: {
                dailyNotes: {
                  notebookId: daily.notebookId === null ? null : (notebookIds.get(daily.notebookId) ?? null),
                  templateId: daily.templateId === null ? null : (noteIds.get(daily.templateId) ?? null),
                  dateFormat: daily.dateFormat,
                },
              },
            },
          });

          // Files whose note was not in the file have nothing to belong to.
          const orphans = [...files.entries()].filter(([, file]) => !noteIds.has(file.noteId));
          if (orphans.length > 0) invalid('attachments', 'belong to a note the file does not hold');

          return {
            notes: summary.notes,
            notebooks: notebookCount,
            tags: tagIds.size,
            versions,
            attachments: attachmentCount,
            shareLinksNotRestored: summary.shareLinks,
          };
        },
        { timeout: RESTORE_TIMEOUT_MS, maxWait: 10_000 },
      )
      .catch(async (error: unknown) => {
        await this.attachments.removeFiles(written);
        throw error;
      });
  }
}
