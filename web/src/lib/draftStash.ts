/**
 * Where a draft goes when the editor closes before it could be saved: the
 * server could not be reached, the session had ended, or the note had changed
 * elsewhere once more. It stays in this tab, under the user and the note it
 * belongs to, and is offered when that user opens the note here again.
 */
export interface StashedDraft {
  title: string;
  content: string;
  /** The revision of the note the draft was based on. */
  revision: number;
  /** When it was put aside, as an ISO date. */
  at: string;
}

const PREFIX = 'notes.draft.';
const keyFor = (userId: string, noteId: string) => `${PREFIX}${userId}.${noteId}`;

/** sessionStorage can be switched off or full. A stash that cannot be kept is no reason to break the editor. */
function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function stashDraft(userId: string, noteId: string, draft: Omit<StashedDraft, 'at'>, now = new Date()): void {
  try {
    storage()?.setItem(keyFor(userId, noteId), JSON.stringify({ ...draft, at: now.toISOString() }));
  } catch {
    // Too large for what is left of the storage, or storage refused.
  }
}

/** The draft kept for this note, and only ever the one of this user. */
export function readStash(userId: string, noteId: string): StashedDraft | null {
  try {
    const stored = storage()?.getItem(keyFor(userId, noteId));
    const draft = stored ? (JSON.parse(stored) as Partial<StashedDraft>) : null;
    const complete =
      draft &&
      typeof draft.title === 'string' &&
      typeof draft.content === 'string' &&
      typeof draft.revision === 'number' &&
      typeof draft.at === 'string';
    return complete ? (draft as StashedDraft) : null;
  } catch {
    return null;
  }
}

export function dropStash(userId: string, noteId: string): void {
  try {
    storage()?.removeItem(keyFor(userId, noteId));
  } catch {
    // Nothing to remove then.
  }
}

/** Drops every draft kept for one user. Those of other users are not touched. */
export function dropStashes(userId: string): void {
  try {
    const store = storage();
    if (!store) return;
    const mine = `${PREFIX}${userId}.`;
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
    for (const key of keys) {
      if (key?.startsWith(mine)) store.removeItem(key);
    }
  } catch {
    // Nothing to remove then.
  }
}
