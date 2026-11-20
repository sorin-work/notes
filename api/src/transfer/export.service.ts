import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { AttachmentsService } from '../attachments/attachments.service';
import { PrismaService } from '../prisma/prisma.service';
import { encodePathPart, replaceAttachmentLinks } from './attachment-links';
import { PassThrough, Readable } from 'node:stream';
import { safeFileName, UniquePaths } from './file-names';
import { FrontMatter, serializeFrontMatter } from './front-matter';

interface ExportableNote {
  title: string;
  content: string;
  pinned: boolean;
  favorite: boolean;
  isTemplate?: boolean;
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
  if (note.isTemplate) data.template = true;
  data.created = note.createdAt.toISOString();
  data.updated = note.updatedAt.toISOString();
  const body = note.content.endsWith('\n') || note.content === '' ? note.content : `${note.content}\n`;
  return serializeFrontMatter(data) + body;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
  ) {}

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
  async exportAll(userId: string): Promise<Readable> {
    // One snapshot for all three: a note moved to a notebook made a moment
    // ago still finds its folder, every folder is the one the note was in,
    // and the files are those of the notes that are exported.
    const [notebooks, notes, files] = await this.prisma.$transaction(
      async (tx) =>
        [
          await tx.notebook.findMany({
            where: { userId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, parentId: true },
          }),
          await tx.note.findMany({
            where: { userId, deletedAt: null },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            include: exportInclude,
          }),
          // The files of the notes go under attachments/<id>/, and the notes link to them there by a
          // relative path, which this app's import and other Markdown apps follow.
          await tx.attachment.findMany({
            where: { userId, note: { userId, deletedAt: null } },
            select: { id: true, fileName: true },
          }),
        ] as const,
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const zip = new JSZip();
    const paths = new UniquePaths();

    const fileOf = new Map(
      files.map((file) => [file.id, `attachments/${file.id}/${safeFileName(file.fileName, 'file')}`]),
    );
    // A file is read when the zip gets to it, one at a time, so the export never holds more
    // than one in memory. A file that is gone is left out and named in MISSING.txt.
    const missing: string[] = [];
    for (const [id, path] of fileOf) {
      if (!(await this.attachments.exists(id))) {
        missing.push(path);
        fileOf.delete(id);
        continue;
      }
      zip.file(path, this.lazyFile(id));
    }
    if (missing.length > 0) {
      this.logger.warn(`Export left out ${missing.length} attachment file(s) that are missing from storage`);
      zip.file(
        'attachments/MISSING.txt',
        `These ${missing.length} attachment files were missing from storage and are not in this export:\n${missing.join('\n')}\n`,
      );
    }
    // The folders are named before any note file, so where a note and a notebook
    // want the same name it is the note that gets the "(2)". "attachments" is
    // taken first when there are files, so a notebook of that name gets a "(2)" too.
    if (fileOf.size > 0 || missing.length > 0) paths.claim('', 'attachments', '');
    const folders = notebookFolders(notebooks, paths);
    for (const note of notes) {
      const folder = (note.notebookId && folders.get(note.notebookId)) || '';
      const path = paths.claim(folder, safeFileName(note.title), '.md');
      const up = '../'.repeat(folder.split('/').filter(Boolean).length);
      const content = replaceAttachmentLinks(note.content, (id) => {
        const file = fileOf.get(id);
        return file && up + file.split('/').map(encodePathPart).join('/');
      });
      zip.file(path, toMarkdownFile({ ...note, content }), { date: note.updatedAt });
    }
    // Written out as it is made: with streamFiles, each file goes into the zip as it is read.
    // JSZip's stream is an old-style one; a PassThrough makes it a stream of this Node.
    const out = new PassThrough();
    zip
      .generateNodeStream({ type: 'nodebuffer', compression: 'DEFLATE', streamFiles: true })
      .on('error', (error: Error) => out.destroy(error))
      .pipe(out);
    return out;
  }

  /** A file of an attachment that is read only when the zip asks for it. */
  private lazyFile(id: string): Readable {
    const read = () => this.attachments.read(id);
    return Readable.from(
      (async function* () {
        yield await read();
      })(),
    );
  }
}
