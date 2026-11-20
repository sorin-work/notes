import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AttachmentsService } from '../attachments/attachments.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { excerpt } from '../common/text';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrashedNote {
  id: string;
  title: string;
  excerpt: string;
  notebook: { id: string; name: string } | null;
  deletedAt: Date;
  /** When the note will be deleted for good. */
  purgeAt: Date;
}

@Injectable()
export class TrashService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly attachments: AttachmentsService,
  ) {}

  async list(userId: string): Promise<TrashedNote[]> {
    const notes = await this.prisma.note.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      include: { notebook: { select: { id: true, name: true } } },
    });
    return notes.map((note) => {
      const deletedAt = note.deletedAt as Date;
      return {
        id: note.id,
        title: note.title,
        excerpt: excerpt(note.content),
        notebook: note.notebook,
        deletedAt,
        purgeAt: new Date(deletedAt.getTime() + this.config.trashRetentionDays * DAY_MS),
      };
    });
  }

  /** Takes a note out of the trash. If its notebook was deleted it comes back without one. */
  async restore(userId: string, id: string): Promise<void> {
    await this.findTrashed(userId, id);
    await this.prisma.note.update({ where: { id }, data: { deletedAt: null } });
  }

  async deletePermanently(userId: string, id: string): Promise<void> {
    await this.findTrashed(userId, id);
    await this.deleteNotes({ id });
  }

  async empty(userId: string): Promise<{ deleted: number }> {
    return { deleted: await this.deleteNotes({ userId }) };
  }

  /** Deletes notes, for every user, that have been in the trash longer than the retention period. */
  async purgeExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.trashRetentionDays * DAY_MS);
    return this.deleteNotes({}, cutoff);
  }

  /**
   * Deletes notes in the trash for good, and the files of their attachments
   * with them. The notes are deleted by id, only while they are still in
   * the trash (and, for the purge, trashed before `cutoff`), and the files
   * removed are those of the notes the DELETE actually took: a note restored
   * in the meantime keeps its rows and its files. The rows go in one
   * transaction; the files right after it. Should that fail half way, the
   * sweep removes what is left.
   */
  private async deleteNotes(where: Prisma.NoteWhereInput, cutoff: Date | null = null): Promise<number> {
    const files = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.note.findMany({
        where: { ...where, deletedAt: { not: null, ...(cutoff ? { lt: cutoff } : {}) } },
        select: { id: true },
      });
      if (candidates.length === 0) return { ids: [], count: 0 };
      const ids = candidates.map((note) => note.id);
      const attachments = await tx.attachment.findMany({
        where: { noteId: { in: ids } },
        select: { id: true, noteId: true },
      });
      const deleted = await tx.$queryRaw<{ id: string }[]>`
        DELETE FROM notes
        WHERE id = ANY(${ids}::uuid[])
          AND deleted_at IS NOT NULL
          AND (${cutoff}::timestamp IS NULL OR deleted_at < ${cutoff}::timestamp)
        RETURNING id`;
      const gone = new Set(deleted.map((row) => row.id));
      return {
        ids: attachments.filter((attachment) => gone.has(attachment.noteId)).map((attachment) => attachment.id),
        count: deleted.length,
      };
    });
    await this.attachments.removeFiles(files.ids);
    return files.count;
  }

  private async findTrashed(userId: string, id: string) {
    const note = await this.prisma.note.findFirst({ where: { id, userId } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    if (!note.deletedAt) {
      throw new ConflictException('This note is not in the trash');
    }
    return note;
  }
}
