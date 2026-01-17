import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { extractWikiLinks, normalizeTitle } from './wikilinks';

export interface OutgoingLink {
  title: string;
  /** The note the link resolves to, or null when no note has that title. */
  noteId: string | null;
}

@Injectable()
export class LinksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rewrites the stored links of a note from its content. */
  async sync(tx: Prisma.TransactionClient, noteId: string, content: string): Promise<void> {
    const links = extractWikiLinks(content);
    await tx.noteLink.deleteMany({ where: { sourceId: noteId } });
    if (links.length > 0) {
      await tx.noteLink.createMany({
        data: links.map((link) => ({
          sourceId: noteId,
          targetTitle: link.title,
          targetKey: normalizeTitle(link.title),
        })),
      });
    }
  }

  /** The links written in a note, with the note each one currently resolves to. */
  async outgoing(userId: string, noteId: string): Promise<OutgoingLink[]> {
    const note = await this.prisma.note.findFirst({
      where: { id: noteId, userId },
      select: { outgoingLinks: { select: { targetTitle: true, targetKey: true } } },
    });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    const targets = await this.resolveKeys(
      userId,
      note.outgoingLinks.map((link) => link.targetKey),
    );
    return note.outgoingLinks.map((link) => ({ title: link.targetTitle, noteId: targets.get(link.targetKey) ?? null }));
  }

  /** The most recently edited note outside the trash with this title. */
  async resolve(userId: string, title: string): Promise<{ id: string; title: string }> {
    const target = (await this.resolveKeys(userId, [normalizeTitle(title)])).get(normalizeTitle(title));
    if (!target) {
      throw new NotFoundException(`No note is called "${title.trim()}"`);
    }
    const note = await this.prisma.note.findUniqueOrThrow({ where: { id: target }, select: { id: true, title: true } });
    return note;
  }

  private async resolveKeys(userId: string, keys: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (keys.length === 0) return result;
    // Titles are matched case-insensitively. Prisma cannot express
    // lower(title) IN (...), so this compares in SQL directly.
    const rows = await this.prisma.$queryRaw<{ id: string; key: string }[]>`
      SELECT DISTINCT ON (key) id, key
      FROM (
        SELECT id, lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) AS key, updated_at
        FROM notes
        WHERE user_id = ${userId}::uuid AND deleted_at IS NULL
      ) titled
      WHERE key = ANY(${keys})
      ORDER BY key, updated_at DESC`;
    for (const row of rows) result.set(row.key, row.id);
    return result;
  }
}
