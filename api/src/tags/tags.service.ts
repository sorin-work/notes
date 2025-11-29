import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeTagNames } from './tag-name';

export interface TagView {
  id: string;
  name: string;
  noteCount: number;
}

@Injectable()
export class TagsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tags with the number of notes that use them. Unused tags are left out. */
  async list(userId: string): Promise<TagView[]> {
    const tags = await this.prisma.tag.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { notes: true } } },
    });
    return tags
      .map((tag) => ({ id: tag.id, name: tag.name, noteCount: tag._count.notes }))
      .filter((tag) => tag.noteCount > 0);
  }

  /** Removes the tag from every note that has it. */
  async remove(userId: string, id: string): Promise<void> {
    await this.findOwned(userId, id);
    await this.prisma.tag.delete({ where: { id } });
  }

  /** Replaces a note's tags, creating tags that do not exist yet. */
  async setNoteTags(tx: Prisma.TransactionClient, userId: string, noteId: string, names: string[]): Promise<string[]> {
    const normalized = normalizeTagNames(names);
    const tagIds: string[] = [];
    for (const name of normalized) {
      const tag = await tx.tag.upsert({
        where: { userId_name: { userId, name } },
        create: { userId, name },
        update: {},
      });
      tagIds.push(tag.id);
    }
    await tx.noteTag.deleteMany({ where: { noteId, tagId: { notIn: tagIds } } });
    await tx.noteTag.createMany({ data: tagIds.map((tagId) => ({ noteId, tagId })), skipDuplicates: true });
    return normalized;
  }

  private async findOwned(userId: string, id: string) {
    const tag = await this.prisma.tag.findFirst({ where: { id, userId } });
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
  }
}
