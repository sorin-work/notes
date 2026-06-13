import { BadRequestException, Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import { LinksService } from '../links/links.service';
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from '../notes/dto/note.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { parseFrontMatter } from './front-matter';

export const MAX_IMPORT_NOTES = 2000;
const NOTE_EXTENSIONS = /\.(md|markdown|txt)$/i;

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
}

export interface ImportResult {
  imported: number;
  notebooksCreated: number;
  skipped: { file: string; reason: string }[];
}

interface Candidate {
  path: string;
  text: string;
  modified?: Date;
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

function ignored(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX');
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tags: TagsService,
    private readonly links: LinksService,
  ) {}

  /** Imports .md / .markdown / .txt files and zips of them. */
  async import(userId: string, files: UploadedFile[]): Promise<ImportResult> {
    if (!files.length) {
      throw new BadRequestException('Choose at least one Markdown file or zip to import');
    }
    const result: ImportResult = { imported: 0, notebooksCreated: 0, skipped: [] };
    const candidates: Candidate[] = [];

    for (const file of files) {
      const name = file.originalname;
      if (/\.zip$/i.test(name)) {
        let zip: JSZip;
        try {
          zip = await JSZip.loadAsync(file.buffer);
        } catch {
          result.skipped.push({ file: name, reason: 'Not a valid zip file' });
          continue;
        }
        for (const entry of Object.values(zip.files)) {
          if (entry.dir || ignored(entry.name)) continue;
          if (!NOTE_EXTENSIONS.test(entry.name)) {
            result.skipped.push({ file: entry.name, reason: 'Not a Markdown or text file' });
            continue;
          }
          candidates.push({ path: entry.name, text: await entry.async('string'), modified: entry.date });
        }
      } else if (NOTE_EXTENSIONS.test(name)) {
        candidates.push({ path: name.split(/[\\/]/).pop() ?? name, text: file.buffer.toString('utf8') });
      } else {
        result.skipped.push({ file: name, reason: 'Not a Markdown, text or zip file' });
      }
    }

    if (candidates.length > MAX_IMPORT_NOTES) {
      throw new BadRequestException(`An import can contain at most ${MAX_IMPORT_NOTES} notes`);
    }

    const notebooks = new NotebookResolver(this.prisma, userId);
    for (const candidate of candidates) {
      const { data, body } = parseFrontMatter(candidate.text);
      if (body.length > MAX_CONTENT_LENGTH) {
        result.skipped.push({ file: candidate.path, reason: 'The note is too long' });
        continue;
      }
      const { folders, name } = splitPath(candidate.path);
      const title = (typeof data.title === 'string' && data.title.trim() ? data.title.trim() : name.trim()).slice(
        0,
        MAX_TITLE_LENGTH,
      );
      const notebookId = await notebooks.resolve(notebookPath(folders));
      const created = toDate(data.created) ?? candidate.modified ?? new Date();
      const updated = toDate(data.updated) ?? candidate.modified ?? created;

      await this.prisma.$transaction(async (tx) => {
        const note = await tx.note.create({
          data: {
            userId,
            notebookId,
            title: title || 'Untitled',
            content: body,
            pinned: data.pinned === true,
            favorite: data.favorite === true || data.favourite === true,
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
