import { Injectable, NotFoundException } from '@nestjs/common';
import type { Note, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** While someone keeps typing, keep at most one version per this interval. */
export const VERSION_INTERVAL_MS = 10 * 60 * 1000;

export interface VersionSummary {
  id: string;
  title: string;
  characters: number;
  createdAt: Date;
}

export interface VersionView extends VersionSummary {
  content: string;
}

@Injectable()
export class VersionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called before a note's title or content changes. Saves the state the note
   * is in now unless a version was saved recently or nothing has changed
   * since the last one.
   */
  async snapshotIfDue(tx: Prisma.TransactionClient, note: Note, now = new Date()): Promise<boolean> {
    const latest = await tx.noteVersion.findFirst({ where: { noteId: note.id }, orderBy: { createdAt: 'desc' } });
    if (latest) {
      const unchanged = latest.title === note.title && latest.content === note.content;
      const recent = now.getTime() - latest.createdAt.getTime() < VERSION_INTERVAL_MS;
      if (unchanged || recent) {
        return false;
      }
    }
    await this.save(tx, note, now);
    return true;
  }

  async list(userId: string, noteId: string): Promise<VersionSummary[]> {
    await this.findNote(userId, noteId);
    const versions = await this.prisma.noteVersion.findMany({
      where: { noteId },
      orderBy: { createdAt: 'desc' },
    });
    return versions.map(({ content, noteId: _noteId, ...version }) => ({ ...version, characters: content.length }));
  }

  async get(userId: string, noteId: string, versionId: string): Promise<VersionView> {
    await this.findNote(userId, noteId);
    const version = await this.findVersion(noteId, versionId);
    const { noteId: _noteId, ...rest } = version;
    return { ...rest, characters: version.content.length };
  }

  private async save(tx: Prisma.TransactionClient, note: Note, now: Date): Promise<void> {
    await tx.noteVersion.create({
      data: { noteId: note.id, title: note.title, content: note.content, createdAt: now },
    });
  }

  private async findNote(userId: string, noteId: string): Promise<Note> {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, userId } });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  private async findVersion(noteId: string, versionId: string) {
    const version = await this.prisma.noteVersion.findFirst({ where: { id: versionId, noteId } });
    if (!version) {
      throw new NotFoundException('Version not found');
    }
    return version;
  }
}
