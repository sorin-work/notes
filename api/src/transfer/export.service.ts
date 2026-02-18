import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { safeFileName } from './file-names';
import { FrontMatter, serializeFrontMatter } from './front-matter';

interface ExportableNote {
  title: string;
  content: string;
  pinned: boolean;
  favorite: boolean;
  createdAt: Date;
  updatedAt: Date;
  tags: { tag: { name: string } }[];
}

const exportInclude = {
  tags: { include: { tag: true }, orderBy: { tag: { name: 'asc' } } },
  notebook: { include: { parent: true } },
} as const;

/** A note as a Markdown file with its title, tags and dates in front matter. */
export function toMarkdownFile(note: ExportableNote): string {
  const data: FrontMatter = { title: note.title };
  const tags = note.tags.map((noteTag) => noteTag.tag.name);
  if (tags.length) data.tags = tags;
  if (note.pinned) data.pinned = true;
  if (note.favorite) data.favorite = true;
  data.created = note.createdAt.toISOString();
  data.updated = note.updatedAt.toISOString();
  const body = note.content.endsWith('\n') || note.content === '' ? note.content : `${note.content}\n`;
  return serializeFrontMatter(data) + body;
}

@Injectable()
export class ExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportNote(userId: string, noteId: string): Promise<{ filename: string; markdown: string }> {
    const note = await this.prisma.note.findFirst({ where: { id: noteId, userId }, include: exportInclude });
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return { filename: `${safeFileName(note.title)}.md`, markdown: toMarkdownFile(note) };
  }
}
