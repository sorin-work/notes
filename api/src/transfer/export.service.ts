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
} as const;

/**
 * The folder of every notebook in the zip, such as "Work/Meetings/", with
 * the notebooks nested as they are in the app. Names only have to differ
 * between notebooks that sit side by side, and two of them can come out the
 * same once the characters a file system refuses are gone, so each folder
 * claims its name in `paths`. A folder then also never takes the name of a
 * note's file next to it, which no file system could hold.
 */
export function notebookFolders(
  notebooks: { id: string; name: string; parentId: string | null }[],
  paths: UniquePaths,
): Map<string, string> {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const folders = new Map<string, string>();
  const folderOf = (id: string | null, above = new Set<string>()): string => {
    const notebook = id === null ? undefined : byId.get(id);
    // A parent that is missing, or a loop in the data, ends the path at the top.
    if (!notebook || above.has(notebook.id)) return '';
    const known = folders.get(notebook.id);
    if (known !== undefined) return known;
    const parent = folderOf(notebook.parentId, above.add(notebook.id));
    const folder = `${paths.claim(parent, safeFileName(notebook.name, 'Notebook'), '')}/`;
    folders.set(notebook.id, folder);
    return folder;
  };
  for (const notebook of notebooks) folderOf(notebook.id);
  return folders;
}

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
   * folders inside folders, as deep as they nest; notes without a notebook
   * sit at the top.
   */
  async exportAll(userId: string): Promise<Buffer> {
    const [notebooks, notes] = await Promise.all([
      this.prisma.notebook.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, parentId: true },
      }),
      this.prisma.note.findMany({
        where: { userId, deletedAt: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: exportInclude,
      }),
    ]);

    const zip = new JSZip();
    const paths = new UniquePaths();
    // The folders are named before any file, so where a note and a notebook
    // want the same name it is the note that gets the "(2)".
    const folders = notebookFolders(notebooks, paths);
    for (const note of notes) {
      const folder = (note.notebookId && folders.get(note.notebookId)) || '';
      const path = paths.claim(folder, safeFileName(note.title), '.md');
      zip.file(path, toMarkdownFile(note), { date: note.updatedAt });
    }
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }
}
