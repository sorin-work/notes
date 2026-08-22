import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface ShareView {
  token: string;
  viewCount: number;
  createdAt: Date;
}

export interface SharedNote {
  title: string;
  content: string;
  tags: string[];
  updatedAt: Date;
}

export function newShareToken(): string {
  return randomBytes(18).toString('base64url');
}

@Injectable()
export class SharesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, noteId: string): Promise<ShareView | null> {
    await this.findNote(userId, noteId);
    const share = await this.prisma.shareLink.findUnique({ where: { noteId } });
    return share ? toShareView(share) : null;
  }

  /** Returns the note's share link, creating one if it has none. */
  async create(userId: string, noteId: string): Promise<ShareView> {
    const note = await this.findNote(userId, noteId);
    if (note.deletedAt) {
      throw new NotFoundException('Note not found');
    }
    const share = await this.prisma.shareLink.upsert({
      where: { noteId },
      create: { noteId, token: newShareToken() },
      update: {},
    });
    return toShareView(share);
  }

  /** Stops sharing. The old link stops working; sharing again makes a new one. */
  async revoke(userId: string, noteId: string): Promise<void> {
    await this.findNote(userId, noteId);
    await this.prisma.shareLink.deleteMany({ where: { noteId } });
  }

  /** The read-only view behind a share link. Notes in the trash are not served. */
  async view(token: string): Promise<SharedNote> {
    const share = await this.prisma.shareLink.findUnique({
      where: { token },
      include: { note: { include: { tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } } } } },
    });
    if (!share || share.note.deletedAt) {
      throw new NotFoundException('This link does not exist or is no longer shared');
    }
    await this.prisma.shareLink.update({ where: { id: share.id }, data: { viewCount: { increment: 1 } } });
    return {
      title: share.note.title,
      content: share.note.content,
      tags: share.note.tags.map((noteTag) => noteTag.tag.name),
      updatedAt: share.note.updatedAt,
    };
  }

  private async findNote(userId: string, noteId: string) {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, userId } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }
}

function toShareView(share: { token: string; viewCount: number; createdAt: Date }): ShareView {
  return { token: share.token, viewCount: share.viewCount, createdAt: share.createdAt };
}
