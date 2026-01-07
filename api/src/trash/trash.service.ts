import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
    await this.prisma.note.delete({ where: { id } });
  }

  async empty(userId: string): Promise<{ deleted: number }> {
    const result = await this.prisma.note.deleteMany({ where: { userId, deletedAt: { not: null } } });
    return { deleted: result.count };
  }

  /** Deletes notes, for every user, that have been in the trash longer than the retention period. */
  async purgeExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.trashRetentionDays * DAY_MS);
    const result = await this.prisma.note.deleteMany({ where: { deletedAt: { lt: cutoff } } });
    return result.count;
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
