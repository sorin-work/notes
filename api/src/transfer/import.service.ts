import { BadRequestException, Injectable } from '@nestjs/common';
import { LinksService } from '../links/links.service';
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from '../notes/dto/note.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { ArchiveRefused, readArchive, UnpackBudget, ARCHIVE_LIMITS } from './archive';
import { EnexRefused, readEnex } from './enex';
import { FrontMatter, parseFrontMatter } from './front-matter';
import { fromNotion, isNotionExport } from './notion';

export const MAX_IMPORT_NOTES = 2000;
const NOTE_EXTENSIONS = /\.(md|markdown|txt)$/i;

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

export interface ImportOptions {
  /** Leave out notes whose title, notebook and text the account already has. */
  skipExisting: boolean;
}

export interface ImportResult {
  imported: number;
  notebooksCreated: number;
  /** Notes left out because the account already has them. */
  duplicates: number;
  /** Attachments and images in Evernote notes, which are not imported. */
  attachmentsSkipped: number;
  skipped: { file: string; reason: string }[];
}

interface Candidate {
  path: string;
  text: string;
  modified?: Date;
  /** Title, tags and dates read already. Set for notes that do not come from a Markdown file. */
  data?: FrontMatter;
  /**
   * The notebooks the note goes into, when they do not come from `path`.
   * An Evernote note's title is a title, and a "/" in it is no folder.
   */
  folders?: string[];
}

/** Splits "Work/Projects/Plan.md" into the notebook path and the file's base name. */
export function splitPath(path: string): { folders: string[]; name: string } {
  const parts = path.split('/').filter((part) => part && part !== '.');
  const file = parts.pop() ?? '';
  return { folders: parts, name: file.replace(NOTE_EXTENSIONS, '') };
}

/**
 * Notebooks only nest one level, so deeper folders are folded into the
 * second level: "A/B/C" becomes notebook "B - C" inside "A".
 */
export function notebookPath(folders: string[]): string[] {
  const cleaned = folders.map((folder) => folder.trim()).filter(Boolean);
  if (cleaned.length <= 2) return cleaned;
  return [cleaned[0], cleaned.slice(1).join(' - ')];
}

function toDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/[,\s]+/);
  return [];
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tags: TagsService,
    private readonly links: LinksService,
  ) {}

  /**
   * Imports .md / .markdown / .txt files, Evernote .enex files, and zips of
   * Markdown such as an Obsidian vault or a Notion export.
   */
  async import(
    userId: string,
    files: UploadedFile[],
    options: ImportOptions = { skipExisting: true },
  ): Promise<ImportResult> {
    if (!files.length) {
      throw new BadRequestException('Choose at least one Markdown, Evernote or zip file to import');
    }
    const result: ImportResult = {
      imported: 0,
      notebooksCreated: 0,
      duplicates: 0,
      attachmentsSkipped: 0,
      skipped: [],
    };
    const candidates: Candidate[] = [];
    const budget = new UnpackBudget(ARCHIVE_LIMITS.totalBytes);

    for (const file of files) {
      const name = file.originalname.split(/[\\/]/).pop() ?? file.originalname;
      if (/\.zip$/i.test(name)) {
        try {
          const contents = await readArchive(
            file.buffer,
            (path) => NOTE_EXTENSIONS.test(path),
            'Not a Markdown or text file',
            budget,
          );
          result.skipped.push(...contents.skipped);
          const paths = contents.files.map((entry) => entry.path);
          candidates.push(...(isNotionExport(paths) ? fromNotion(contents.files) : contents.files));
        } catch (error) {
          if (!(error instanceof ArchiveRefused)) throw error;
          result.skipped.push({ file: name, reason: error.message });
        }
      } else if (/\.enex$/i.test(name)) {
        try {
          const contents = readEnex(file.buffer.toString('utf8'), name);
          result.skipped.push(...contents.skipped);
          result.attachmentsSkipped += contents.resourcesSkipped;
          // An Evernote export is one notebook, and the file is named after it.
          const notebook = name.replace(/\.enex$/i, '');
          for (const note of contents.notes) {
            candidates.push({
              path: `${name}: ${note.title}`,
              text: note.markdown,
              data: note.data,
              folders: notebook.trim() ? [notebook] : [],
            });
          }
        } catch (error) {
          if (!(error instanceof EnexRefused)) throw error;
          result.skipped.push({ file: name, reason: error.message });
        }
      } else if (NOTE_EXTENSIONS.test(name)) {
        candidates.push({ path: name, text: file.buffer.toString('utf8') });
      } else {
        result.skipped.push({ file: name, reason: 'Not a Markdown, text, Evernote or zip file' });
      }
    }

    if (candidates.length > MAX_IMPORT_NOTES) {
      throw new BadRequestException(`An import can contain at most ${MAX_IMPORT_NOTES} notes`);
    }

    const notebooks = new NotebookResolver(this.prisma, userId);
    for (const candidate of candidates) {
      const { data, body } = candidate.data
        ? { data: candidate.data, body: candidate.text }
        : parseFrontMatter(candidate.text);
      if (body.length > MAX_CONTENT_LENGTH) {
        result.skipped.push({ file: candidate.path, reason: 'The note is too long' });
        continue;
      }
      const split = splitPath(candidate.path);
      const folders = candidate.folders ?? split.folders;
      const name = split.name;
      const title = (typeof data.title === 'string' && data.title.trim() ? data.title.trim() : name.trim()).slice(
        0,
        MAX_TITLE_LENGTH,
      );
      const notebookId = await notebooks.resolve(notebookPath(folders));
      const finalTitle = title || 'Untitled';
      if (
        options.skipExisting &&
        (await this.prisma.note.findFirst({
          where: { userId, notebookId, title: finalTitle, content: body, deletedAt: null },
          select: { id: true },
        }))
      ) {
        result.duplicates++;
        continue;
      }
      const created = toDate(data.created) ?? candidate.modified ?? new Date();
      const updated = toDate(data.updated) ?? candidate.modified ?? created;

      await this.prisma.$transaction(async (tx) => {
        const note = await tx.note.create({
          data: {
            userId,
            notebookId,
            title: finalTitle,
            content: body,
            pinned: data.pinned === true,
            favorite: data.favorite === true || data.favourite === true,
            isTemplate: data.template === true,
            createdAt: created,
            updatedAt: updated,
          },
        });
        const tags = toTags(data.tags).slice(0, 20);
        if (tags.length) await this.tags.setNoteTags(tx, userId, note.id, tags);
        if (body) await this.links.sync(tx, note.id, body);
      });
      result.imported++;
    }

    result.notebooksCreated = notebooks.created;
    return result;
  }
}

/** Finds or creates the notebooks for imported folders, matching names case-insensitively. */
class NotebookResolver {
  created = 0;
  private readonly cache = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly userId: string,
  ) {}

  async resolve(path: string[]): Promise<string | null> {
    let parentId: string | null = null;
    for (const segment of path) {
      const name = segment.slice(0, 80);
      const key = `${parentId ?? ''}/${name.toLowerCase()}`;
      let id = this.cache.get(key);
      if (!id) {
        const existing: { id: string } | null = await this.prisma.notebook.findFirst({
          where: { userId: this.userId, parentId, name: { equals: name, mode: 'insensitive' } },
          select: { id: true },
        });
        if (existing) {
          id = existing.id;
        } else {
          id = (await this.prisma.notebook.create({ data: { userId: this.userId, parentId, name } })).id;
          this.created++;
        }
        this.cache.set(key, id);
      }
      parentId = id;
    }
    return parentId;
  }
}
