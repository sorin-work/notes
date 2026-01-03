import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { excerpt } from '../common/text';
import { PrismaService } from '../prisma/prisma.service';

export interface TrashedNote {
  id: string;
  title: string;
  excerpt: string;
  notebook: { id: string; name: string } | null;
  deletedAt: Date;
}

@Injectable()
export class TrashService {
  constructor(private readonly prisma: PrismaService) {}

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
