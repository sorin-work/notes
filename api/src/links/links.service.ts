import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { extractWikiLinks, normalizeTitle } from './wikilinks';

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
}
