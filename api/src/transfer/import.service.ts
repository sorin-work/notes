import { BadRequestException, Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import { LinksService } from '../links/links.service';
import { MAX_NOTEBOOK_DEPTH, NotebooksService } from '../notebooks/notebooks.service';
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
 * Folders become notebooks at the depth they have, as far as notebooks
 * nest. What is deeper is folded into the last level: with four levels,
 * "A/B/C/D/E" becomes notebook "D - E" inside "A/B/C".
 */
export function notebookPath(folders: string[]): string[] {
  const cleaned = folders.map((folder) => folder.trim()).filter(Boolean);
  if (cleaned.length <= MAX_NOTEBOOK_DEPTH) return cleaned;
  return [...cleaned.slice(0, MAX_NOTEBOOK_DEPTH - 1), cleaned.slice(MAX_NOTEBOOK_DEPTH - 1).join(' - ')];
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
    private readonly notebooks: NotebooksService,
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
      const created = toDate(data.created) ?? candidate.modified ?? new Date();
      const updated = toDate(data.updated) ?? candidate.modified ?? created;

      // The notebooks and the note in one transaction, under the lock on the
      // tree: a notebook moved or deleted at the same moment can neither end
      // up too deep nor leave the note without its notebook.
      await this.prisma.$transaction(async (tx) => {
        // Names are cut to the length a notebook name can have.
        const path = notebookPath(folders).map((name) => name.slice(0, 80));
        const notebook = await this.notebooks.findOrCreatePath(tx, userId, path);
        const notebookId = notebook.id;
        result.notebooksCreated += notebook.created;
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

    return result;
  }
}
