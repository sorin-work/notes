/**
 * The full JSON backup: what an account holds, including what the zip export
 * leaves out (the trash, version history, revisions, share links). Its
 * shape is stated in the README; `version` goes up when it changes in a way
 * an older reader would get wrong.
 */
export const BACKUP_FORMAT = 'notes-backup';
export const BACKUP_VERSION = 1;

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

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  notebooks: BackupNotebook[];
  tags: BackupTag[];
  shareLinks: BackupShareLink[];
  notes: BackupNote[];
}
