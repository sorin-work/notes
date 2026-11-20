/** Choices kept with the account, so they are the same on every device. Theme and editor mode stay in the browser. */
export interface Preferences {
  /** What the note behind "Today" is made with. */
  dailyNotes: {
    notebookId: string | null;
    templateId: string | null;
    dateFormat: 'iso' | 'long' | 'us';
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  preferences: Preferences;
}

export interface AuthResult {
  token: string;
  user: User;
}

/** A personal API token as Settings lists it. The token itself is not part of it. */
export interface ApiToken {
  id: string;
  name: string;
  readOnly: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedApiToken extends ApiToken {
  /** Only in the answer to creating it. */
  token: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** A shared notebook whose link makes something public. */
export interface SharedThrough {
  id: string;
  name: string;
}

export interface Notebook {
  id: string;
  name: string;
  parentId: string | null;
  noteCount: number;
  /** Templates are not counted as notes, but deleting the notebook trashes them too. */
  templateCount: number;
  /** Whether the notebook has a share link of its own. */
  shared: boolean;
  /** The shared notebook that makes this one public: itself, or the one it is inside. */
  sharedThrough: SharedThrough | null;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  noteCount: number;
}

export interface NoteSummary {
  id: string;
  title: string;
  excerpt: string;
  notebookId: string | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  /** Goes up with every change to the title or the content. A save names the revision it was based on. */
  revision: number;
  /** A template is kept out of the lists and the search, and new notes are made from it. */
  isTemplate: boolean;
  /** The day (YYYY-MM-DD) this note is the daily note of, if it is one. */
  dailyDate: string | null;
  notebookId: string | null;
  notebook: { id: string; name: string; parentId: string | null } | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  /** Whether the note has a share link of its own. */
  shared: boolean;
  /** The shared notebook that makes the note public, if one does. */
  sharedThrough: SharedThrough | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface NoteChanges {
  title?: string;
  content?: string;
  /**
   * The revision the title or content was based on. If the note has changed
   * since, the save is refused (see `staleNote`). Without it the last write wins.
   */
  revision?: number;
  /** Keep the text this save replaces as a version, whatever the usual interval. */
  keepVersion?: boolean;
  isTemplate?: boolean;
  /** For a new note: the template to make it from. */
  templateId?: string;
  /** For a new note from a template: what {{date}} and {{time}} are filled with. */
  placeholders?: { date?: string; time?: string };
  notebookId?: string | null;
  tags?: string[];
  pinned?: boolean;
  favorite?: boolean;
}

export interface Backlink {
  id: string;
  title: string;
  updatedAt: string;
  context: string;
}

/** A note that writes another note's title without linking to it, with the place where it does. */
export interface Mention {
  id: string;
  title: string;
  updatedAt: string;
  /** The line of the mention: what stands before it, the mention as written, what follows. */
  before: string;
  match: string;
  after: string;
  /** Where the mention starts in that note's text, and the revision of the note it was found in. */
  offset: number;
  version: number;
}

export interface MentionPage extends Page<Mention> {
  /** True when more notes matched than the server read, so some mentions may be missing. */
  capped: boolean;
}

export interface GraphNode {
  id: string;
  title: string;
  /**
   * How many links the note has to and from other notes, wherever they are.
   * More than its edges in the graph when some lead to notes that the
   * filters or the limit left out.
   */
  links: number;
}

/** Notes and the links between them. `total` is larger than the number of nodes when the server cut the graph short. */
export interface Graph {
  nodes: GraphNode[];
  edges: { source: string; target: string }[];
  total: number;
}

export interface OutgoingLink {
  title: string;
  noteId: string | null;
}

export interface VersionSummary {
  id: string;
  title: string;
  characters: number;
  createdAt: string;
}

export interface Version extends VersionSummary {
  content: string;
}

export interface TrashedNote {
  id: string;
  title: string;
  excerpt: string;
  notebook: { id: string; name: string } | null;
  deletedAt: string;
  purgeAt: string;
}

export interface SearchHit {
  id: string;
  title: string;
  snippet: string;
  notebookId: string | null;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  updatedAt: string;
}

export interface Share {
  token: string;
  viewCount: number;
  createdAt: string;
  /** null when the link does not run out. */
  expiresAt: string | null;
  /** The link has run out and answers like one that does not exist. */
  expired: boolean;
  /** Readers are asked for a password. The password itself never comes back from the API. */
  hasPassword: boolean;
}

/** What can be changed about a link. Left out means "as it is", null means "take it away". */
export interface ShareOptions {
  expiresAt?: string | null;
  password?: string | null;
}

export interface SharedNote {
  kind: 'note';
  title: string;
  /** With [[links]] left only where the reader may follow them. */
  content: string;
  tags: string[];
  updatedAt: string;
  /** Where each of those links leads, by normalised title: a path under /s/. */
  links: Record<string, string>;
  /** Signed addresses of the note's own attachments, by id. They run out in minutes. */
  attachments: Record<string, string>;
}

/** A file of a note: a pasted image or an attached PDF. */
export interface Attachment {
  id: string;
  noteId: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
  /** Works without a login for a few minutes. */
  url: string;
  /** What to put in the note to show or link it. */
  markdown: string;
}

/** The index of a shared notebook. */
export interface SharedNotebook {
  kind: 'notebook';
  name: string;
  notes: { id: string; title: string; updatedAt: string; notebook: string | null }[];
}

/** What a link shares: a note, or a notebook with everything in it. */
export type ShareSubject = { noteId: string } | { notebookId: string };

/** What a restored backup put into the account. */
export interface RestoreResult {
  notes: number;
  notebooks: number;
  tags: number;
  versions: number;
  /** Share links listed in the backup. They are not made again. */
  shareLinksNotRestored: number;
}

export interface ImportResult {
  imported: number;
  notebooksCreated: number;
  /** Notes left out because the account has them already. */
  duplicates: number;
  /** Attachments and images in Evernote notes, which are not imported. */
  attachmentsSkipped: number;
  skipped: { file: string; reason: string }[];
}
