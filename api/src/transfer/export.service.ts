import { Injectable, NotFoundException } from '@nestjs/common';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { safeFileName, UniquePaths } from './file-names';
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

  /**
   * Every note outside the trash as a zip of Markdown files. Notebooks become
   * folders; notes without a notebook sit at the top.
   */
  async exportAll(userId: string): Promise<Buffer> {
    const notes = await this.prisma.note.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: exportInclude,
    });

    const zip = new JSZip();
    const paths = new UniquePaths();
    for (const note of notes) {
      const folders: string[] = [];
      if (note.notebook?.parent) folders.push(safeFileName(note.notebook.parent.name, 'Notebook'));
      if (note.notebook) folders.push(safeFileName(note.notebook.name, 'Notebook'));
      const folder = folders.map((name) => `${name}/`).join('');
      const path = paths.claim(folder, safeFileName(note.title), '.md');
      zip.file(path, toMarkdownFile(note), { date: note.updatedAt });
    }
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}
