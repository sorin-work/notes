import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AttachmentsService, StoredFile } from '../attachments/attachments.service';
import { LinksService } from '../links/links.service';
import { MAX_NOTEBOOK_DEPTH, NotebooksService } from '../notebooks/notebooks.service';
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from '../notes/dto/note.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { ArchiveRefused, readArchive, UnpackBudget, ARCHIVE_LIMITS } from './archive';
import { EnexRefused, readEnex } from './enex';
import { FrontMatter, parseFrontMatter } from './front-matter';
import { ATTACHMENT_EXTENSIONS, FileReference, linkAttachments, withoutAttachmentIds } from './attachment-links';
import { fromNotion, isNotionExport, stripNotionIds } from './notion';

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
  /** Images and PDFs from zips and loose files, attached to the notes that link to them. */
  attachmentsImported: number;
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
  /** The images and PDFs next to the note, by path, which its links may lead to. */
  files?: FileSet;
}

/** The images and PDFs of one zip, or the loose ones of an upload, found by path or by name. */
class FileSet {
  private readonly byPath = new Map<string, Buffer>();
  private readonly byName = new Map<string, string>();
  readonly linked = new Set<string>();

  constructor(
    files: { path: string; bytes: Buffer }[],
    private readonly notion = false,
  ) {
    for (const file of files) {
      this.byPath.set(file.path, file.bytes);
      const name = (file.path.split('/').pop() ?? '').toLowerCase();
      if (!this.byName.has(name)) this.byName.set(name, file.path);
    }
  }

  get size(): number {
    return this.byPath.size;
  }

  /** The file a link means: by its path, or, for an Obsidian embed, by its name anywhere in the vault. */
  find(path: string, embed: boolean): string | undefined {
    for (const candidate of [path, this.notion ? stripNotionIds(path) : null]) {
      if (candidate && this.byPath.has(candidate)) return candidate;
    }
    if (embed) return this.byName.get((path.split('/').pop() ?? '').toLowerCase());
    return undefined;
  }

  bytes(path: string): Buffer | undefined {
    return this.byPath.get(path);
  }

  paths(): string[] {
    return [...this.byPath.keys()];
  }
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

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tags: TagsService,
    private readonly links: LinksService,
    private readonly attachments: AttachmentsService,
    private readonly notebooks: NotebooksService,
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
      attachmentsImported: 0,
      skipped: [],
    };
    const fileSets: FileSet[] = [];
    const loose: { path: string; bytes: Buffer }[] = [];
    const looseNotes: Candidate[] = [];
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
            undefined,
            (path) => ATTACHMENT_EXTENSIONS.test(path),
          );
          result.skipped.push(...contents.skipped);
          const paths = contents.files.map((entry) => entry.path);
          const notion = isNotionExport(paths);
          const files = new FileSet(
            notion
              ? contents.binaries.map((entry) => ({ ...entry, path: stripNotionIds(entry.path) }))
              : contents.binaries,
            notion,
          );
          fileSets.push(files);
          const notes = notion ? fromNotion(contents.files) : contents.files;
          candidates.push(...notes.map((note) => ({ ...note, files })));
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
        const note: Candidate = { path: name, text: file.buffer.toString('utf8') };
        looseNotes.push(note);
        candidates.push(note);
      } else if (ATTACHMENT_EXTENSIONS.test(name)) {
        // An image or PDF sent with the notes that link to it.
        loose.push({ path: name, bytes: file.buffer });
      } else {
        result.skipped.push({ file: name, reason: 'Not a Markdown, text, Evernote or zip file' });
      }
    }

    const looseFiles = new FileSet(loose);
    fileSets.push(looseFiles);
    for (const note of looseNotes) note.files = looseFiles;

    if (candidates.length > MAX_IMPORT_NOTES) {
      throw new BadRequestException(`An import can contain at most ${MAX_IMPORT_NOTES} notes`);
    }

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
      // Names are cut to the length a notebook name can have.
      const path = notebookPath(folders).map((folder) => folder.slice(0, 80));
      // Only looked up here, for the check for duplicates. The notebooks are
      // made in the transaction of the note, under the lock on the tree.
      const existingNotebook = await this.notebooks.findPath(userId, path);
      const finalTitle = title || 'Untitled';

      // Links to images and PDFs next to the note become attachment: links, with ids made now.
      const planned = new Map<string, FileReference & { id: string }>();
      const files = candidate.files;
      const linked =
        files && files.size > 0
          ? linkAttachments(
              body,
              candidate.path,
              (path, embed) => files.find(path, embed),
              (reference) => {
                const known = planned.get(reference.path) ?? { ...reference, id: randomUUID() };
                planned.set(reference.path, known);
                return known.id;
              },
            )
          : body;
      if (linked.length > MAX_CONTENT_LENGTH) {
        result.skipped.push({ file: candidate.path, reason: 'The note is too long' });
        continue;
      }

      if (
        options.skipExisting &&
        existingNotebook !== undefined &&
        (await this.exists(userId, existingNotebook, finalTitle, linked, planned.size > 0))
      ) {
        result.duplicates++;
        for (const reference of planned.values()) files?.linked.add(reference.path);
        continue;
      }

      const stored: StoredFile[] = [];
      for (const reference of planned.values()) {
        files?.linked.add(reference.path);
        const bytes = files?.bytes(reference.path);
        const file = bytes ? await this.attachments.store(reference.path, bytes, reference.id) : null;
        if (file) stored.push(file);
        else
          result.skipped.push({
            file: reference.path,
            reason: 'Not an image or PDF that can be attached, or too large',
          });
      }
      const storedIds = new Set(stored.map((file) => file.id));
      // A link whose file was refused goes back to what it was.
      let content =
        stored.length === planned.size
          ? linked
          : linkAttachments(
              body,
              candidate.path,
              (path, embed) => {
                const found = files?.find(path, embed);
                return found && storedIds.has(planned.get(found)?.id ?? '') ? found : undefined;
              },
              (reference) => planned.get(reference.path)?.id ?? '',
            );
      const created = toDate(data.created) ?? candidate.modified ?? new Date();
      const updated = toDate(data.updated) ?? candidate.modified ?? created;

      let attached = 0;
      await this.prisma
        .$transaction(async (tx) => {
          // A notebook moved or deleted at the same moment can neither end up
          // too deep nor leave the note without its notebook.
          const notebook = await this.notebooks.findOrCreatePath(tx, userId, path);
          const notebookId = notebook.id;
          result.notebooksCreated += notebook.created;
          const bytes = stored.reduce((sum, file) => sum + file.size, 0);
          if (stored.length > 0 && !(await this.attachments.hasRoom(tx, userId, bytes))) {
            result.skipped.push({
              file: candidate.path,
              reason: 'Its images and PDFs would go past the account limit',
            });
            content = body;
            stored.length = 0;
          }
          const note = await tx.note.create({
            data: {
              userId,
              notebookId,
              title: finalTitle,
              content,
              pinned: data.pinned === true,
              favorite: data.favorite === true || data.favourite === true,
              isTemplate: data.template === true,
              createdAt: created,
              updatedAt: updated,
            },
          });
          const tags = toTags(data.tags).slice(0, 20);
          if (tags.length) await this.tags.setNoteTags(tx, userId, note.id, tags);
          if (stored.length > 0) {
            await tx.attachment.createMany({ data: stored.map((file) => ({ ...file, userId, noteId: note.id })) });
            attached = stored.length;
          }
          if (content) await this.links.sync(tx, note.id, content);
        })
        .catch(async (error: unknown) => {
          await this.attachments.removeFiles([...planned.values()].map((item) => item.id));
          throw error;
        });
      // Files the note did not keep: refused, or past the account limit.
      const kept = new Set(attached > 0 ? stored.map((file) => file.id) : []);
      const dropped = [...storedIds].filter((id) => !kept.has(id));
      if (dropped.length > 0) await this.attachments.removeFiles(dropped);
      result.attachmentsImported += attached;
      result.imported++;
    }

    for (const set of fileSets) {
      for (const path of set.paths()) {
        if (!set.linked.has(path)) result.skipped.push({ file: path, reason: 'No note links to it' });
      }
    }
    return result;
  }

  /**
   * Whether the account has this note already: same title, notebook and
   * text, outside the trash. Links to attachments count as the same
   * whichever attachment they name, since a re-import makes new ones.
   */
  private async exists(
    userId: string,
    notebookId: string | null,
    title: string,
    content: string,
    hasAttachments: boolean,
  ): Promise<boolean> {
    if (!hasAttachments) {
      return !!(await this.prisma.note.findFirst({
        where: { userId, notebookId, title, content, deletedAt: null },
        select: { id: true },
      }));
    }
    const rows = await this.prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM notes
      WHERE user_id = ${userId}::uuid
        AND notebook_id IS NOT DISTINCT FROM ${notebookId}::uuid
        AND title = ${title}
        AND deleted_at IS NULL
        AND regexp_replace(content, 'attachment:[0-9a-f-]{36}', 'attachment:', 'g') = ${withoutAttachmentIds(content)}
      LIMIT 1`;
    return rows.length > 0;
  }
}
