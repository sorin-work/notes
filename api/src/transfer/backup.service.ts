import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { LinksService } from '../links/links.service';
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from '../notes/dto/note.dto';
import { PrismaService } from '../prisma/prisma.service';
import { readPreferences } from '../auth/preferences';
import { DATE_FORMATS } from '../common/day';
import { normalizeTagNames } from '../tags/tag-name';
import { MAX_VERSIONS_PER_NOTE } from '../versions/versions.service';
import {
  Backup,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupNote,
  BackupNotebook,
  BackupShareLink,
  BackupTag,
  BackupVersion,
} from './backup';

/** Notes read from the database at a time while the backup is written out. */
const BATCH = 200;
export const MAX_BACKUP_NOTES = 20_000;
const MAX_BACKUP_NOTEBOOKS = 2_000;
const MAX_BACKUP_TAGS = 10_000;
const MAX_NOTEBOOK_NAME = 80;
const MAX_REVISION = 2_147_483_647;
/** Restoring writes a lot in one transaction, which may take longer than the default five seconds. */
const RESTORE_TIMEOUT_MS = 5 * 60 * 1000;

export interface RestoreResult {
  notes: number;
  notebooks: number;
  tags: number;
  versions: number;
  /** Share links in the file. They are not made again: see the README. */
  shareLinksNotRestored: number;
}

const iso = (date: Date) => date.toISOString();
const isoOrNull = (date: Date | null) => (date ? date.toISOString() : null);

const backupNoteInclude = {
  tags: { select: { tag: { select: { name: true } } }, orderBy: { tag: { name: 'asc' } } },
  versions: { select: { title: true, content: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.NoteInclude;

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: LinksService,
  ) {}

  /**
   * The account's backup as JSON, in pieces. The small lists come first and
   * the notes one by one after them, read from the database a batch at a
   * time, so neither the API nor the browser holds the whole file at once.
   */
  async *write(userId: string, now = new Date()): AsyncGenerator<string> {
    const [user, notebooks, tags, shareLinks] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { preferences: true } }),
      this.prisma.notebook.findMany({ where: { userId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.tag.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      this.prisma.shareLink.findMany({
        where: { OR: [{ note: { userId } }, { notebook: { userId } }] },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    // Parents before the notebooks inside them, so a reader can make them in order.
    notebooks.sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));

    const head = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: iso(now),
      preferences: readPreferences(user.preferences),
      notebooks: notebooks.map((notebook): BackupNotebook => ({
        id: notebook.id,
        name: notebook.name,
        parentId: notebook.parentId,
        createdAt: iso(notebook.createdAt),
        updatedAt: iso(notebook.updatedAt),
      })),
      tags: tags.map((tag): BackupTag => ({ name: tag.name, createdAt: iso(tag.createdAt) })),
      // No token and no password hash: the file must not open the shares for whoever holds it.
      shareLinks: shareLinks.map((link): BackupShareLink => ({
        noteId: link.noteId,
        notebookId: link.notebookId,
        hasPassword: link.passwordHash !== null,
        expiresAt: isoOrNull(link.expiresAt),
        viewCount: link.viewCount,
        createdAt: iso(link.createdAt),
      })),
    };
    const opening = JSON.stringify(head);
    yield `${opening.slice(0, -1)},"notes":[`;

    let after: string | undefined;
    let first = true;
    for (;;) {
      const batch = await this.prisma.note.findMany({
        where: { userId, ...(after ? { id: { gt: after } } : {}) },
        orderBy: { id: 'asc' },
        take: BATCH,
        include: backupNoteInclude,
      });
      for (const note of batch) {
        const entry: BackupNote = {
          id: note.id,
          title: note.title,
          content: note.content,
          notebookId: note.notebookId,
          tags: note.tags.map((noteTag) => noteTag.tag.name),
          pinned: note.pinned,
          favorite: note.favorite,
          isTemplate: note.isTemplate,
          dailyDate: note.dailyDate ? note.dailyDate.toISOString().slice(0, 10) : null,
          dailyReleased: note.dailyReleased,
          revision: note.revision,
          createdAt: iso(note.createdAt),
          updatedAt: iso(note.updatedAt),
          deletedAt: isoOrNull(note.deletedAt),
          versions: note.versions.map((version) => ({
            title: version.title,
            content: version.content,
            createdAt: iso(version.createdAt),
          })),
        };
        yield `${first ? '' : ','}\n${JSON.stringify(entry)}`;
        first = false;
      }
      if (batch.length < BATCH) break;
      after = batch[batch.length - 1].id;
    }
    yield '\n]}\n';
  }

  /**
   * Puts a backup into an account that has nothing in it yet: the notes with
   * their history, revisions, tags and trash, and the notebooks they were in.
   * Everything gets new ids. All of it is written in one transaction, so a
   * restore that fails leaves the account as empty as it was.
   *
   * Share links are not made again. The file holds no tokens, so a new link
   * would have a new address, and no password hashes, so a link that had a
   * password would come back open. The owner shares again where they want to.
   */
  async restore(userId: string, file: Buffer): Promise<RestoreResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.toString('utf8'));
    } catch {
      throw new BadRequestException('The file is not JSON');
    }
    const backup = readBackup(parsed);

    return this.prisma.$transaction(
      async (tx) => {
        // The user row is locked, so that two restores at once cannot both find the account empty.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        const [notes, notebooks, tags] = await Promise.all([
          tx.note.count({ where: { userId } }),
          tx.notebook.count({ where: { userId } }),
          tx.tag.count({ where: { userId } }),
        ]);
        if (notes + notebooks + tags > 0) {
          throw new ConflictException(
            'A backup is restored into an empty account. This one has notes, notebooks or tags already.',
          );
        }

        const notebookIds = new Map(backup.notebooks.map((notebook) => [notebook.id, randomUUID()]));
        // Parents first, so the foreign key on parent_id is satisfied.
        for (const level of [false, true]) {
          const batch = backup.notebooks.filter((notebook) => (notebook.parentId !== null) === level);
          if (batch.length === 0) continue;
          await tx.notebook.createMany({
            data: batch.map((notebook) => ({
              id: notebookIds.get(notebook.id) as string,
              userId,
              name: notebook.name,
              parentId: notebook.parentId === null ? null : (notebookIds.get(notebook.parentId) as string),
              createdAt: new Date(notebook.createdAt),
              updatedAt: new Date(notebook.updatedAt),
            })),
          });
        }

        const tagNames = new Map<string, Date>();
        for (const tag of backup.tags) tagNames.set(tag.name, new Date(tag.createdAt));
        for (const note of backup.notes)
          for (const name of note.tags) if (!tagNames.has(name)) tagNames.set(name, new Date());
        if (tagNames.size > 0) {
          await tx.tag.createMany({
            data: [...tagNames].map(([name, createdAt]) => ({ userId, name, createdAt })),
            skipDuplicates: true,
          });
        }
        const tagIds = new Map(
          (await tx.tag.findMany({ where: { userId }, select: { id: true, name: true } })).map((tag) => [
            tag.name,
            tag.id,
          ]),
        );

        const noteIds = new Map(backup.notes.map((note) => [note.id, randomUUID()]));
        let versions = 0;
        for (let start = 0; start < backup.notes.length; start += BATCH) {
          const batch = backup.notes.slice(start, start + BATCH);
          await tx.note.createMany({
            data: batch.map((note) => ({
              id: noteIds.get(note.id) as string,
              userId,
              notebookId: note.notebookId === null ? null : (notebookIds.get(note.notebookId) as string),
              title: note.title,
              content: note.content,
              pinned: note.pinned,
              favorite: note.favorite,
              isTemplate: note.isTemplate,
              dailyDate: note.dailyDate === null ? null : new Date(`${note.dailyDate}T00:00:00Z`),
              dailyReleased: note.dailyReleased,
              revision: note.revision,
              createdAt: new Date(note.createdAt),
              updatedAt: new Date(note.updatedAt),
              deletedAt: note.deletedAt === null ? null : new Date(note.deletedAt),
            })),
          });
          const noteTags = batch.flatMap((note) =>
            note.tags.map((name) => ({ noteId: noteIds.get(note.id) as string, tagId: tagIds.get(name) as string })),
          );
          if (noteTags.length > 0) await tx.noteTag.createMany({ data: noteTags });
          const history = batch.flatMap((note) =>
            note.versions.map((version) => ({
              noteId: noteIds.get(note.id) as string,
              title: version.title,
              content: version.content,
              createdAt: new Date(version.createdAt),
            })),
          );
          if (history.length > 0) await tx.noteVersion.createMany({ data: history });
          versions += history.length;
          for (const note of batch) {
            if (note.content) await this.links.sync(tx, noteIds.get(note.id) as string, note.content);
          }
        }

        // The daily note choices, pointing at the new notebook and template.
        const daily = backup.preferences.dailyNotes;
        await tx.user.update({
          where: { id: userId },
          data: {
            preferences: {
              dailyNotes: {
                notebookId: daily.notebookId === null ? null : (notebookIds.get(daily.notebookId) ?? null),
                templateId: daily.templateId === null ? null : (noteIds.get(daily.templateId) ?? null),
                dateFormat: daily.dateFormat,
              },
            },
          },
        });

        return {
          notes: backup.notes.length,
          notebooks: backup.notebooks.length,
          tags: tagNames.size,
          versions,
          shareLinksNotRestored: backup.shareLinks.length,
        };
      },
      { timeout: RESTORE_TIMEOUT_MS, maxWait: 10_000 },
    );
  }
}

/** Says what is wrong with the file in a 400, naming the place. */
function invalid(where: string, what: string): never {
  throw new BadRequestException(`Not a backup this app can restore: ${where} ${what}`);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function list(value: unknown, where: string, max: number): unknown[] {
  if (!Array.isArray(value)) invalid(where, 'is not a list');
  if (value.length > max) invalid(where, `has more than ${max} entries`);
  return value;
}

function text(value: unknown, where: string, max: number, { empty = true } = {}): string {
  if (typeof value !== 'string') invalid(where, 'is not text');
  if (value.length > max) invalid(where, `is longer than ${max} characters`);
  if (!empty && !value.trim()) invalid(where, 'is empty');
  return value;
}

function date(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    invalid(where, 'is not a date and time in UTC');
  }
  if (Number.isNaN(new Date(value).getTime())) invalid(where, 'is not a real date');
  return value;
}

function day(value: unknown, where: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(where, 'is not a day as YYYY-MM-DD');
  const read = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(read.getTime()) || read.toISOString().slice(0, 10) !== value) invalid(where, 'is not a real day');
  return value;
}

function id(value: unknown, where: string): string {
  return text(value, where, 100, { empty: false });
}

/**
 * Checks the whole file before anything is written, with the same limits a
 * note, a notebook and a tag have when they are made in the app, and that
 * every reference points at something the file holds.
 */
export function readBackup(value: unknown): Backup {
  if (!isObject(value) || value.format !== BACKUP_FORMAT) invalid('the file', `is not a ${BACKUP_FORMAT} file`);
  if (value.version !== BACKUP_VERSION) invalid('version', `${String(value.version)} is not ${BACKUP_VERSION}`);

  const notebooks = list(value.notebooks, 'notebooks', MAX_BACKUP_NOTEBOOKS).map((entry, index): BackupNotebook => {
    const where = `notebooks[${index}]`;
    if (!isObject(entry)) invalid(where, 'is not an object');
    return {
      id: id(entry.id, `${where}.id`),
      name: text(entry.name, `${where}.name`, MAX_NOTEBOOK_NAME, { empty: false }).trim(),
      parentId: entry.parentId === null ? null : id(entry.parentId, `${where}.parentId`),
      createdAt: date(entry.createdAt, `${where}.createdAt`),
      updatedAt: date(entry.updatedAt, `${where}.updatedAt`),
    };
  });
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  if (byId.size !== notebooks.length) invalid('notebooks', 'has two with the same id');
  const names = new Set<string>();
  for (const [index, notebook] of notebooks.entries()) {
    if (notebook.parentId !== null) {
      const parent = byId.get(notebook.parentId);
      if (!parent) invalid(`notebooks[${index}].parentId`, 'names no notebook in the file');
      // The nesting rule of the app: one level.
      if (parent.parentId !== null) invalid(`notebooks[${index}]`, 'is nested deeper than notebooks can be');
    }
    const key = `${notebook.parentId ?? ''}/${notebook.name.toLowerCase()}`;
    if (names.has(key)) invalid(`notebooks[${index}].name`, 'is taken by another notebook in the same place');
    names.add(key);
  }

  const tags = list(value.tags, 'tags', MAX_BACKUP_TAGS).map((entry, index): BackupTag => {
    const where = `tags[${index}]`;
    if (!isObject(entry)) invalid(where, 'is not an object');
    const [name] = normalizeTagNames([text(entry.name, `${where}.name`, 200)]);
    if (!name) invalid(`${where}.name`, 'is not a tag name');
    return { name, createdAt: date(entry.createdAt, `${where}.createdAt`) };
  });

  const notes = list(value.notes, 'notes', MAX_BACKUP_NOTES).map((entry, index): BackupNote => {
    const where = `notes[${index}]`;
    if (!isObject(entry)) invalid(where, 'is not an object');
    const notebookId = entry.notebookId === null ? null : id(entry.notebookId, `${where}.notebookId`);
    if (notebookId !== null && !byId.has(notebookId)) invalid(`${where}.notebookId`, 'names no notebook in the file');
    const tagList = list(entry.tags, `${where}.tags`, 20).map((tag, tagIndex) =>
      text(tag, `${where}.tags[${tagIndex}]`, 200),
    );
    if (typeof entry.pinned !== 'boolean') invalid(`${where}.pinned`, 'is not true or false');
    if (typeof entry.favorite !== 'boolean') invalid(`${where}.favorite`, 'is not true or false');
    if (typeof entry.isTemplate !== 'boolean') invalid(`${where}.isTemplate`, 'is not true or false');
    if (typeof entry.dailyReleased !== 'boolean') invalid(`${where}.dailyReleased`, 'is not true or false');
    const dailyDate = entry.dailyDate === null ? null : day(entry.dailyDate, `${where}.dailyDate`);
    if (
      !Number.isInteger(entry.revision) ||
      (entry.revision as number) < 0 ||
      (entry.revision as number) > MAX_REVISION
    ) {
      invalid(`${where}.revision`, 'is not a whole number of zero or more');
    }
    const versions = list(entry.versions, `${where}.versions`, MAX_VERSIONS_PER_NOTE).map(
      (version, versionIndex): BackupVersion => {
        const at = `${where}.versions[${versionIndex}]`;
        if (!isObject(version)) invalid(at, 'is not an object');
        return {
          title: text(version.title, `${at}.title`, MAX_TITLE_LENGTH),
          content: text(version.content, `${at}.content`, MAX_CONTENT_LENGTH),
          createdAt: date(version.createdAt, `${at}.createdAt`),
        };
      },
    );
    return {
      id: id(entry.id, `${where}.id`),
      title: text(entry.title, `${where}.title`, MAX_TITLE_LENGTH),
      content: text(entry.content, `${where}.content`, MAX_CONTENT_LENGTH),
      notebookId,
      tags: normalizeTagNames(tagList),
      pinned: entry.pinned,
      favorite: entry.favorite,
      isTemplate: entry.isTemplate,
      dailyDate,
      dailyReleased: entry.dailyReleased,
      revision: entry.revision as number,
      createdAt: date(entry.createdAt, `${where}.createdAt`),
      updatedAt: date(entry.updatedAt, `${where}.updatedAt`),
      deletedAt: entry.deletedAt === null ? null : date(entry.deletedAt, `${where}.deletedAt`),
      versions,
    };
  });
  if (new Set(notes.map((note) => note.id)).size !== notes.length) invalid('notes', 'has two with the same id');
  const days = notes.flatMap((note) => (note.dailyDate ? [note.dailyDate] : []));
  if (new Set(days).size !== days.length) invalid('notes', 'has two daily notes for the same day');

  const preferences = isObject(value.preferences) ? value.preferences : {};
  const daily = isObject(preferences.dailyNotes) ? preferences.dailyNotes : {};
  const reference = (ref: unknown, where: string, known: (key: string) => boolean): string | null => {
    if (ref === null || ref === undefined) return null;
    const key = id(ref, where);
    if (!known(key)) invalid(where, 'names nothing in the file');
    return key;
  };
  const dateFormat = DATE_FORMATS.find((format) => format === daily.dateFormat) ?? 'iso';
  const templateIds = new Set(notes.filter((note) => note.isTemplate).map((note) => note.id));

  const shareLinks = list(value.shareLinks, 'shareLinks', MAX_BACKUP_NOTES + MAX_BACKUP_NOTEBOOKS).map(
    (entry, index): BackupShareLink => {
      const where = `shareLinks[${index}]`;
      if (!isObject(entry)) invalid(where, 'is not an object');
      return {
        noteId: entry.noteId === null ? null : id(entry.noteId, `${where}.noteId`),
        notebookId: entry.notebookId === null ? null : id(entry.notebookId, `${where}.notebookId`),
        hasPassword: entry.hasPassword === true,
        expiresAt: entry.expiresAt === null ? null : date(entry.expiresAt, `${where}.expiresAt`),
        viewCount: Number.isInteger(entry.viewCount) ? (entry.viewCount as number) : 0,
        createdAt: date(entry.createdAt, `${where}.createdAt`),
      };
    },
  );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: date(value.exportedAt, 'exportedAt'),
    preferences: {
      dailyNotes: {
        notebookId: reference(daily.notebookId, 'preferences.dailyNotes.notebookId', (key) => byId.has(key)),
        templateId: reference(daily.templateId, 'preferences.dailyNotes.templateId', (key) => templateIds.has(key)),
        dateFormat,
      },
    },
    notebooks,
    tags,
    shareLinks,
    notes,
  };
}
