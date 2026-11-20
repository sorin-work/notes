import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../auth/password';
import { PrismaService } from '../prisma/prisma.service';
import { ShareOptionsDto } from './dto/share.dto';

/** What the owner sees of a link. The password itself is never given back, only whether there is one. */
export interface ShareView {
  token: string;
  viewCount: number;
  createdAt: Date;
  expiresAt: Date | null;
  /** True once expiresAt has passed. The link then answers like one that does not exist. */
  expired: boolean;
  hasPassword: boolean;
}

export interface SharedNote {
  title: string;
  content: string;
  tags: string[];
  updatedAt: Date;
}

/** Who is asking for a shared note, as far as the request says. */
export interface ShareViewer {
  /** The account of a valid login token sent along, if any. */
  userId?: string;
  /** What was typed into the password prompt, if anything. */
  password?: string;
}

/**
 * The one answer for every link that cannot be read: mistyped, revoked,
 * expired, or its note in the trash. Someone outside cannot tell which.
 */
const GONE = 'This link does not exist or is no longer shared';

export function newShareToken(): string {
  return randomBytes(18).toString('base64url');
}

/**
 * The 403 that makes the page ask for the password. It has to be different
 * from "gone", or there would be nothing to show the prompt on. That a live
 * link has a password is all it gives away. Not a 401: the web app takes a
 * 401 to mean that its own login is over.
 */
function passwordRequired(message: string): ForbiddenException {
  return new ForbiddenException({ statusCode: 403, error: 'Forbidden', message, passwordRequired: true });
}

@Injectable()
export class SharesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string, noteId: string): Promise<ShareView | null> {
    await this.findNote(userId, noteId);
    const share = await this.prisma.shareLink.findUnique({ where: { noteId } });
    return share ? toShareView(share) : null;
  }

  /** Returns the note's share link, creating one if it has none. Options that are given are applied either way. */
  async create(userId: string, noteId: string, options: ShareOptionsDto = {}): Promise<ShareView> {
    const note = await this.findNote(userId, noteId);
    if (note.deletedAt) {
      throw new NotFoundException('Note not found');
    }
    const changes = await this.changesFrom(options);
    const share = await this.prisma.shareLink.upsert({
      where: { noteId },
      create: { noteId, token: newShareToken(), ...changes },
      update: changes,
    });
    return toShareView(share);
  }

  /** Changes when the link runs out and whether it asks for a password. The link itself stays the same. */
  async update(userId: string, noteId: string, options: ShareOptionsDto): Promise<ShareView> {
    await this.findNote(userId, noteId);
    const existing = await this.prisma.shareLink.findUnique({ where: { noteId } });
    if (!existing) {
      throw new NotFoundException('This note is not shared');
    }
    const share = await this.prisma.shareLink.update({
      where: { noteId },
      data: await this.changesFrom(options),
    });
    return toShareView(share);
  }

  /** Stops sharing. The old link stops working; sharing again makes a new one. */
  async revoke(userId: string, noteId: string): Promise<void> {
    await this.findNote(userId, noteId);
    await this.prisma.shareLink.deleteMany({ where: { noteId } });
  }

  /**
   * The read-only view behind a share link.
   *
   * The order of the checks matters. "Gone" comes first, so an expired link
   * with a password looks like any other dead link and not like a prompt.
   * The view is counted last, and not for the owner looking at their own.
   */
  async view(token: string, viewer: ShareViewer = {}, now = new Date()): Promise<SharedNote> {
    const share = await this.prisma.shareLink.findUnique({
      where: { token },
      include: { note: { include: { tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } } } } },
    });
    if (!share || share.note.deletedAt || isExpired(share, now)) {
      throw new NotFoundException(GONE);
    }
    if (share.passwordHash) {
      if (viewer.password === undefined) {
        throw passwordRequired('This note is protected by a password');
      }
      if (!(await verifyPassword(viewer.password, share.passwordHash))) {
        throw passwordRequired('That password is not right');
      }
    }
    if (viewer.userId !== share.note.userId) {
      await this.prisma.shareLink.update({ where: { id: share.id }, data: { viewCount: { increment: 1 } } });
    }
    return {
      title: share.note.title,
      content: share.note.content,
      tags: share.note.tags.map((noteTag) => noteTag.tag.name),
      updatedAt: share.note.updatedAt,
    };
  }

  /** undefined leaves a column alone, null empties it. */
  private async changesFrom(
    options: ShareOptionsDto,
  ): Promise<{ expiresAt?: Date | null; passwordHash?: string | null }> {
    const changes: { expiresAt?: Date | null; passwordHash?: string | null } = {};
    if (options.expiresAt !== undefined) {
      const expiresAt = options.expiresAt === null ? null : new Date(options.expiresAt);
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('expiresAt must be in the future');
      }
      changes.expiresAt = expiresAt;
    }
    if (options.password !== undefined) {
      // The same function as for account passwords.
      changes.passwordHash = options.password === null ? null : await hashPassword(options.password);
    }
    return changes;
  }

  private async findNote(userId: string, noteId: string) {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, userId } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }
}

function isExpired(share: { expiresAt: Date | null }, now: Date): boolean {
  return share.expiresAt !== null && share.expiresAt.getTime() <= now.getTime();
}

function toShareView(
  share: { token: string; viewCount: number; createdAt: Date; expiresAt: Date | null; passwordHash: string | null },
  now = new Date(),
): ShareView {
  return {
    token: share.token,
    viewCount: share.viewCount,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    expired: isExpired(share, now),
    hasPassword: share.passwordHash !== null,
  };
}
