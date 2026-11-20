/**
 * The full JSON backup: what an account holds, including what the zip export
 * leaves out (the trash, version history, revisions, share links). Its
 * shape is stated in the README; `version` goes up when it changes in a way
 * an older reader would get wrong.
 */
export const BACKUP_FORMAT = 'notes-backup';
export const BACKUP_VERSION = 2;
/**
 * The versions a restore reads. Version 2 added `attachments` and
 * `missingAttachments`; a version 1 file has neither, and restores the same
 * way otherwise.
 */
export const READABLE_BACKUP_VERSIONS: readonly number[] = [1, 2];

export interface BackupNotebook {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupTag {
  name: string;
  createdAt: string;
}

export interface BackupVersion {
  title: string;
  content: string;
  createdAt: string;
}

export interface BackupNote {
  id: string;
  title: string;
  content: string;
  notebookId: string | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  /** A template, which new notes are made from. */
  isTemplate: boolean;
  /** The day this is the daily note of, as YYYY-MM-DD. */
  dailyDate: string | null;
  /** Set when the user said this note is not the note of its day. */
  dailyReleased: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Set for a note in the trash. */
  deletedAt: string | null;
  /** Oldest first. */
  versions: BackupVersion[];
}

/**
 * A share link as a record of what was shared. There is no token and no
 * password hash in it: the file must not open anything for whoever holds it.
 */
export interface BackupShareLink {
  noteId: string | null;
  notebookId: string | null;
  hasPassword: boolean;
  expiresAt: string | null;
  viewCount: number;
  createdAt: string;
}

/**
 * The file of an attachment, with its bytes in base64. Its type is not in
 * the file: a restore decides it from the bytes, as an upload does.
 */
export interface BackupAttachment {
  id: string;
  noteId: string;
  fileName: string;
  createdAt: string;
  data: string;
}

/** The choices kept with the account. Ids are those of the file. */
export interface BackupPreferences {
  dailyNotes: { notebookId: string | null; templateId: string | null; dateFormat: string };
}

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  preferences: BackupPreferences;
  notebooks: BackupNotebook[];
  tags: BackupTag[];
  shareLinks: BackupShareLink[];
  /** Before the notes, so a restore can give their links the new ids as the notes come in. */
  attachments: BackupAttachment[];
  notes: BackupNote[];
}
