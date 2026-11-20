import { BadRequestException } from '@nestjs/common';
import { DATE_FORMATS } from '../common/day';
import { MAX_NOTEBOOK_DEPTH } from '../notebooks/notebooks.service';
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from '../notes/dto/note.dto';
import { normalizeTagNames } from '../tags/tag-name';
import { MAX_VERSIONS_PER_NOTE } from '../versions/versions.service';
import {
  Backup,
  BackupAttachment,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  READABLE_BACKUP_VERSIONS,
  BackupNote,
  BackupNotebook,
  BackupPreferences,
  BackupShareLink,
  BackupTag,
  BackupVersion,
} from './backup';

/**
 * The checks a backup goes through, part by part, so that a restore can
 * check each part as it arrives. The limits are the app's own: a backup the
 * app writes always passes them, and nothing passes that the app would not
 * let a user make.
 */

const MAX_NOTEBOOK_NAME = 80;
const MAX_REVISION = 2_147_483_647;

/** Says what is wrong with the file in a 400, naming the place. */
export function invalid(where: string, what: string): never {
  throw new BadRequestException(`Not a backup this app can restore: ${where} ${what}`);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function list(value: unknown, where: string, max = Infinity): unknown[] {
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

export function readFormat(format: unknown, version: unknown): void {
  if (format !== BACKUP_FORMAT) invalid('the file', `is not a ${BACKUP_FORMAT} file`);
  if (typeof version !== 'number' || !READABLE_BACKUP_VERSIONS.includes(version)) {
    invalid('version', `${String(version)} is not one this app reads (${READABLE_BACKUP_VERSIONS.join(', ')})`);
  }
}

export function readExportedAt(value: unknown): string {
  return date(value, 'exportedAt');
}

/** How many notebooks one backup may hold. The checks below are linear, this keeps them short too. */
export const MAX_BACKUP_NOTEBOOKS = 10_000;

/** All notebooks, checked together: ids, names in their place, and nesting as deep as notebooks go, without loops. */
export function readNotebooks(value: unknown): BackupNotebook[] {
  const notebooks = list(value, 'notebooks', MAX_BACKUP_NOTEBOOKS).map((entry, index): BackupNotebook => {
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
    }
    const key = `${notebook.parentId ?? ''}/${notebook.name.toLowerCase()}`;
    if (names.has(key)) invalid(`notebooks[${index}].name`, 'is taken by another notebook in the same place');
    names.add(key);
  }
  // The nesting rule of the app: MAX_NOTEBOOK_DEPTH levels, and no notebook inside itself.
  const depths = notebookDepths(notebooks);
  notebooks.forEach((notebook, index) => {
    const depth = depths.get(notebook.id);
    if (depth === undefined) invalid(`notebooks[${index}]`, 'is inside itself');
    if (depth > MAX_NOTEBOOK_DEPTH) invalid(`notebooks[${index}]`, 'is nested deeper than notebooks can be');
  });
  return notebooks;
}

/**
 * The level of each notebook, 1 at the top, from the parents in the list.
 * A notebook in a loop, or below one, gets no level. Notebooks whose parent
 * is not in the list count as at the top. One pass: each notebook is
 * walked up from only until a notebook whose level, or whose being in a
 * loop, is known already, so the work grows with the number of notebooks
 * and not faster, however the parents are made up.
 */
export function notebookDepths(notebooks: { id: string; parentId: string | null }[]): Map<string, number> {
  const parents = new Map(notebooks.map((notebook) => [notebook.id, notebook.parentId]));
  const known = new Map<string, number | 'loop'>();
  for (const notebook of notebooks) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let base: number | 'loop' = 0;
    for (let at: string | null | undefined = notebook.id; at && parents.has(at); at = parents.get(at)) {
      const level = known.get(at);
      if (level !== undefined) {
        base = level;
        break;
      }
      if (onPath.has(at)) {
        base = 'loop';
        break;
      }
      path.push(at);
      onPath.add(at);
    }
    for (let index = path.length - 1; index >= 0; index--) {
      if (base !== 'loop') base += 1;
      known.set(path[index], base);
    }
  }
  const depths = new Map<string, number>();
  for (const [id, level] of known) if (level !== 'loop') depths.set(id, level);
  return depths;
}

export function readTags(value: unknown): BackupTag[] {
  return list(value, 'tags').map((entry, index): BackupTag => {
    const where = `tags[${index}]`;
    if (!isObject(entry)) invalid(where, 'is not an object');
    const [name] = normalizeTagNames([text(entry.name, `${where}.name`, 200)]);
    if (!name) invalid(`${where}.name`, 'is not a tag name');
    return { name, createdAt: date(entry.createdAt, `${where}.createdAt`) };
  });
}

export function readShareLinks(value: unknown): BackupShareLink[] {
  return list(value, 'shareLinks').map((entry, index): BackupShareLink => {
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
  });
}

/** An attachment's file in base64. Whether its bytes are a type that may be attached is decided on restore. */
export function readAttachment(entry: unknown, index: number): BackupAttachment {
  const where = `attachments[${index}]`;
  if (!isObject(entry)) invalid(where, 'is not an object');
  const data = entry.data;
  if (typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) invalid(`${where}.data`, 'is not base64');
  return {
    id: id(entry.id, `${where}.id`),
    noteId: id(entry.noteId, `${where}.noteId`),
    fileName: text(entry.fileName, `${where}.fileName`, 200, { empty: false }),
    createdAt: date(entry.createdAt, `${where}.createdAt`),
    data,
  };
}

/** One note, with the limits of a note typed in the app. `notebooks` are the ids the file holds. */
export function readNote(entry: unknown, index: number, notebooks: Set<string>): BackupNote {
  const where = `notes[${index}]`;
  if (!isObject(entry)) invalid(where, 'is not an object');
  const notebookId = entry.notebookId === null ? null : id(entry.notebookId, `${where}.notebookId`);
  if (notebookId !== null && !notebooks.has(notebookId))
    invalid(`${where}.notebookId`, 'names no notebook in the file');
  const tagList = list(entry.tags, `${where}.tags`, 20).map((tag, tagIndex) =>
    text(tag, `${where}.tags[${tagIndex}]`, 200),
  );
  if (typeof entry.pinned !== 'boolean') invalid(`${where}.pinned`, 'is not true or false');
  if (typeof entry.favorite !== 'boolean') invalid(`${where}.favorite`, 'is not true or false');
  if (typeof entry.isTemplate !== 'boolean') invalid(`${where}.isTemplate`, 'is not true or false');
  if (typeof entry.dailyReleased !== 'boolean') invalid(`${where}.dailyReleased`, 'is not true or false');
  const dailyDate = entry.dailyDate === null ? null : day(entry.dailyDate, `${where}.dailyDate`);
  const revision = entry.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0 || revision > MAX_REVISION) {
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
    revision,
    createdAt: date(entry.createdAt, `${where}.createdAt`),
    updatedAt: date(entry.updatedAt, `${where}.updatedAt`),
    deletedAt: entry.deletedAt === null ? null : date(entry.deletedAt, `${where}.deletedAt`),
    versions,
  };
}

/**
 * The daily note choices. What is missing or unknown becomes the default; a
 * reference to a notebook or template the file does not hold is refused.
 */
export function readPreferences(value: unknown, notebooks: Set<string>, templates: Set<string>): BackupPreferences {
  const preferences = isObject(value) ? value : {};
  const daily = isObject(preferences.dailyNotes) ? preferences.dailyNotes : {};
  const reference = (ref: unknown, where: string, known: Set<string>): string | null => {
    if (ref === null || ref === undefined) return null;
    const key = id(ref, where);
    if (!known.has(key)) invalid(where, 'names nothing in the file');
    return key;
  };
  return {
    dailyNotes: {
      notebookId: reference(daily.notebookId, 'preferences.dailyNotes.notebookId', notebooks),
      templateId: reference(daily.templateId, 'preferences.dailyNotes.templateId', templates),
      dateFormat: DATE_FORMATS.find((format) => format === daily.dateFormat) ?? 'iso',
    },
  };
}

/** Rules across notes, kept while they come in one by one. */
export class NoteRules {
  private readonly ids = new Set<string>();
  private readonly days = new Set<string>();
  readonly templates = new Set<string>();

  add(note: BackupNote): void {
    if (this.ids.has(note.id)) invalid('notes', 'has two with the same id');
    this.ids.add(note.id);
    if (note.dailyDate) {
      if (this.days.has(note.dailyDate)) invalid('notes', 'has two daily notes for the same day');
      this.days.add(note.dailyDate);
    }
    if (note.isTemplate) this.templates.add(note.id);
  }
}

/** A whole backup held in memory, checked at once. The restore reads part by part instead. */
export function readBackup(value: unknown): Backup {
  if (!isObject(value)) invalid('the file', `is not a ${BACKUP_FORMAT} file`);
  readFormat(value.format, value.version);
  const notebooks = readNotebooks(value.notebooks);
  const notebookIds = new Set(notebooks.map((notebook) => notebook.id));
  const rules = new NoteRules();
  const notes = list(value.notes, 'notes').map((entry, index) => {
    const note = readNote(entry, index, notebookIds);
    rules.add(note);
    return note;
  });
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: readExportedAt(value.exportedAt),
    preferences: readPreferences(value.preferences, notebookIds, rules.templates),
    notebooks,
    tags: readTags(value.tags),
    shareLinks: readShareLinks(value.shareLinks),
    attachments: value.attachments === undefined ? [] : list(value.attachments, 'attachments').map(readAttachment),
    notes,
  };
}
