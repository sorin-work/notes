import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { ApiError, getToken } from '../api/client';
import { listNotebooks } from '../api/notebooks';
import {
  createNote,
  duplicateNote,
  exportNote,
  getNote,
  noteTitles,
  orphanedLinkCount,
  outgoingLinks,
  releaseDailyNote,
  renameLinks,
  resolveTitle,
  staleNote,
  trashNote,
  updateNote,
} from '../api/notes';
import { listTags } from '../api/tags';
import type { Note, NoteChanges, SharedThrough } from '../api/types';
import { useUserId } from '../auth/AuthContext';
import { useActiveOption } from '../hooks/useActiveOption';
import { useAutosave } from '../hooks/useAutosave';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useStoredState } from '../hooks/useStoredState';
import { formatDateTime, formatRelative } from '../lib/dates';
import { dropStash, readStash, stashDraft } from '../lib/draftStash';
import { leavingTemplates, newNoteFor, readFilters } from '../lib/filters';
import { notify } from '../lib/notices';
import {
  cannotReachServer,
  createOffline,
  offlineWritingAvailable,
  onSent,
  onSentElsewhere,
  openEntryFor,
  QueuedElsewhere,
  queueText,
  resolveEntry,
  useOutbox,
} from '../lib/outbox';
import { newlyPublicThrough } from '../lib/sharing';
import { toggleTask } from '../lib/tasks';
import { fromTemplate } from '../lib/templates';
import { registerUnsavedWork } from '../lib/unsavedWork';
import { countWords, DEFAULT_TITLE, readingMinutes, savedTitle } from '../lib/text';
import { normalizeTitle, openLinkAt } from '../lib/wikilinks';
import { BacklinksPanel } from './BacklinksPanel';
import { ConflictDialog } from './ConflictDialog';
import { PinIcon } from './Icons';
import { LinkSuggestions, suggestionAt, suggestionCount, suggestionId, SUGGESTIONS_ID } from './LinkSuggestions';
import { MarkdownPreview } from './MarkdownPreview';
import { ConfirmDialog } from './Modal';
import { NotebookSelect } from './NotebookSelect';
import { ShareDialog } from './ShareDialog';
import { ErrorMessage, Spinner } from './States';
import { TagInput } from './TagInput';
import { VersionHistoryDialog } from './VersionHistoryDialog';

const MODES = ['edit', 'split', 'preview'] as const;
type Mode = (typeof MODES)[number];
const MODE_LABELS: Record<Mode, string> = { edit: 'Edit', split: 'Split', preview: 'Preview' };

interface Draft {
  title: string;
  content: string;
}

export function NoteEditor({ noteId }: { noteId: string }) {
  const note = useQuery({ queryKey: ['note', noteId], queryFn: () => getNote(noteId) });
  if (note.isPending && note.fetchStatus === 'paused') {
    return (
      <div className="editor-missing">
        <p>This note has not been opened on this device before, so it cannot be shown without a connection.</p>
      </div>
    );
  }
  if (note.isLoading) return <Spinner />;
  if (note.error) {
    const missing = note.error instanceof ApiError && note.error.status === 404;
    return missing ? (
      <div className="editor-missing">
        <p>This note does not exist, or it was deleted for good.</p>
      </div>
    ) : (
      <ErrorMessage error={note.error} onRetry={() => void note.refetch()} />
    );
  }
  if (!note.data) return null;
  return <LoadedEditor note={note.data} />;
}

/**
 * One id per waiting entry and version of it: the note "keep both" or leaving
 * makes from it, so asking again, or retrying, never queues a second copy.
 */
const keptIds = new Map<string, string>();
function keepBothId(entry: { seq?: number; version: number; noteId: string }, whose: 'mine' | 'theirs'): string {
  const key = `${whose}:${entry.noteId}:${entry.seq}:${entry.version}`;
  let id = keptIds.get(key);
  if (!id) {
    id = crypto.randomUUID();
    keptIds.set(key, id);
  }
  return id;
}

function LoadedEditor({ note }: { note: Note }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Text kept on this device that the server has not seen yet is newer than the note it came with.
  const [queuedAtOpen] = useState(() => openEntryFor(note.id));
  const [title, setTitle] = useState(queuedAtOpen?.title ?? note.title);
  const [content, setContent] = useState(queuedAtOpen?.content ?? note.content);
  const [mode, setMode] = useStoredState<Mode>('notes.editorMode', MODES, 'split');
  const [dialog, setDialog] = useState<'history' | 'share' | 'delete' | 'conflict' | null>(null);
  // In "Edit" there is no preview on the page, and printing is about the preview. One is put
  // in for as long as the browser prints, and only then, so typing does not render it twice.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  // A move into a shared notebook waits for a yes: it makes the note public.
  const [publicMove, setPublicMove] = useState<{ notebookId: string; through: SharedThrough } | null>(null);
  const [link, setLink] = useState<{ start: number; query: string } | null>(null);
  const readOnly = note.deletedAt !== null;

  const refreshLists = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
  }, [queryClient]);

  // The revision the text in this editor is based on. `note.revision` will
  // not do: the cached note is refreshed and changed by other things, while
  // the text here only moves on with a save, a restore or a settled conflict.
  const revision = useRef(queuedAtOpen?.baseRevision ?? note.revision);
  // Set by "keep mine, put theirs in the history" for the save that follows.
  const keepTheirs = useRef(false);

  // The user this editor was opened for. It is still known when the session has ended under it.
  const [ownerId] = useState(useUserId());
  // A draft that could not be saved the last time this note was left in this
  // tab. It is only ever looked for under the id of the user who is signed in.
  const [stashed, setStashed] = useState(() => {
    const kept = ownerId ? readStash(ownerId, note.id) : null;
    const alreadySaved = kept && savedTitle(kept.title) === note.title && kept.content === note.content;
    if (ownerId && alreadySaved) dropStash(ownerId, note.id);
    return kept && !alreadySaved ? kept : null;
  });
  // Whether the stash in the storage is the text now in the editor, to be dropped once that is saved.
  const stashInEditor = useRef(false);
  // Whether the stash is still on offer, neither restored nor discarded.
  const offeredStash = useRef(stashed !== null);
  // What this tab sent in saves that were never answered. One of them may have been written all the same.
  const unanswered = useRef<Draft[]>([]);
  // The text this editor's changes are made on: what it opened with, or last
  // saved, queued or took over. A change is only queued on top of that.
  const parent = useRef<Draft>({ title: title, content: content });

  const adopt = useCallback(
    (saved: Note) => {
      revision.current = saved.revision;
      parent.current = { title: saved.title, content: saved.content };
      if (ownerId && stashInEditor.current) {
        dropStash(ownerId, note.id);
        stashInEditor.current = false;
      }
      queryClient.setQueryData(['note', note.id], saved);
      void queryClient.invalidateQueries({ queryKey: ['links', note.id] });
      void queryClient.invalidateQueries({ queryKey: ['backlinks'] });
      void queryClient.invalidateQueries({ queryKey: ['versions', note.id] });
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    [note.id, ownerId, queryClient],
  );

  const saveDraft = useCallback(
    async (draft: Draft) => {
      const isText = (server: Note, sent: Draft) =>
        server.title === savedTitle(sent.title) && server.content === sent.content;
      // While this note has text waiting on the device, newer text joins it
      // there, so that the changes to the note reach the server in order.
      if (ownerId && openEntryFor(note.id)) {
        // Thrown as a conflict when another tab queued text this editor never saw.
        await queueText(ownerId, note.id, draft, revision.current, [], parent.current);
        parent.current = draft;
        return;
      }
      for (;;) {
        const changes = { ...draft, revision: revision.current, keepVersion: keepTheirs.current || undefined };
        try {
          adopt(await updateNote(note.id, changes));
          break;
        } catch (error) {
          if (ownerId && cannotReachServer(error) && offlineWritingAvailable()) {
            // Kept on the device and sent when the server can be reached. The
            // text may have arrived all the same; the outbox will recognise it.
            await queueText(ownerId, note.id, draft, revision.current, [...unanswered.current, draft], parent.current);
            parent.current = draft;
            unanswered.current = [];
            keepTheirs.current = false;
            return;
          }
          const theirs = staleNote(error);
          if (theirs && isText(theirs, draft)) {
            // The server already holds exactly this text. There is nothing to decide.
            adopt(theirs);
            break;
          }
          if (theirs && unanswered.current.some((sent) => isText(theirs, sent))) {
            // What the server holds is what this tab sent before: the answer
            // got lost, not the save. No other tab is involved, so the newer
            // text simply goes on top of that revision.
            unanswered.current = [];
            revision.current = theirs.revision;
            continue;
          }
          // Without an answer, or with an error of the server, the text may have been written all the same.
          const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
          if (!refused) unanswered.current = [...unanswered.current.slice(-9), draft];
          throw error;
        }
      }
      unanswered.current = [];
      keepTheirs.current = false;
    },
    [note.id, adopt, ownerId],
  );

  // Leaving the note with a conflict still open must not drop anything, and
  // there is nobody left to ask. The draft is saved and the other text goes
  // into the history. Should the note change yet again meanwhile, try anew.
  // Nobody watched it happen, so a notice says what was done.
  const saveOverConflict = useCallback(
    async (draft: Draft, conflict: unknown) => {
      if (conflict instanceof QueuedElsewhere && ownerId) {
        // Nobody left to ask. The other tab's waiting text is not touched at
        // all; this tab's text becomes a note of its own, and only once that
        // create is safely queued does the draft count as saved.
        const title = `${savedTitle(draft.title)} (kept when leaving)`;
        await createOffline(ownerId, { title, content: draft.content }, keepBothId(conflict.queued, 'mine'));
        notify(
          `“${savedTitle(draft.title)}” had changes waiting from another tab when you left it. The note keeps that tab's text, and yours is in a new note, “${title}”.`,
        );
        return;
      }
      let theirs = staleNote(conflict);
      for (let attempt = 0; ; attempt++) {
        try {
          adopt(await updateNote(note.id, { ...draft, revision: theirs?.revision, keepVersion: true }));
          break;
        } catch (error) {
          theirs = staleNote(error);
          if (!theirs || attempt === 2) throw error;
        }
      }
      notify(
        `“${savedTitle(draft.title)}” had been changed somewhere else when you left it. Your text was saved, and the other version was moved to the history of the note.`,
      );
    },
    [note.id, adopt, ownerId],
  );

  // A draft that is still unsaved when the editor closes is put aside in this
  // tab before the last save is tried, and taken out again when that worked.
  // A draft from an earlier visit that is still on offer is not replaced
  // unless the new one could not be saved either.
  const farewell = useMemo(() => {
    if (!ownerId) return undefined;
    let draftLeft: Draft | null = null;
    const put = (draft: Draft) => stashDraft(ownerId, note.id, { ...draft, revision: revision.current });
    return {
      keep: (draft: Draft) => {
        draftLeft = draft;
        if (!offeredStash.current) put(draft);
      },
      saved: () => {
        if (!offeredStash.current) dropStash(ownerId, note.id);
      },
      failed: () => {
        if (!draftLeft) return;
        put(draftLeft);
        // After a sign-out there is nobody to tell. The draft is offered when the note is opened again.
        if (getToken()) {
          notify(
            `Your last changes to “${savedTitle(draftLeft.title)}” could not be saved. They are kept in this tab: open the note again to get them back.`,
          );
        }
      },
    };
  }, [ownerId, note.id]);

  const autosave = useAutosave(
    saveDraft,
    undefined,
    {
      isConflict: (error) => staleNote(error) !== null || error instanceof QueuedElsewhere,
      onConflict: () => setDialog('conflict'),
      saveOver: saveOverConflict,
    },
    farewell,
  );
  // Another tab of this browser queued text of this note that this editor never saw.
  const elsewhere = autosave.conflict instanceof QueuedElsewhere ? autosave.conflict.queued : null;
  const theirs =
    staleNote(autosave.conflict) ??
    (elsewhere ? ({ ...note, title: savedTitle(elsewhere.title), content: elsewhere.content } as Note) : null);

  // Another tab sent a change of this note: what is on screen here is older.
  const [savedElsewhere, setSavedElsewhere] = useState(false);
  useEffect(() => onSentElsewhere((noteId) => noteId === note.id && setSavedElsewhere(true)), [note.id]);

  // What this note has waiting on the device. When the outbox sends it, the
  // text here is on the server, at the revision the answer names.
  const queued = useOutbox().find((entry) => entry.noteId === note.id) ?? null;
  useEffect(
    () =>
      onSent((saved) => {
        if (saved.id !== note.id) return;
        revision.current = saved.revision;
        unanswered.current = [];
      }),
    [note.id],
  );
  // The outbox met a newer note on the server. It keeps the text and asks, here, the usual question.
  const [queuedQuestionClosed, setQueuedQuestionClosed] = useState(false);
  const takeTheirsQueued = useMutation({
    mutationFn: async () => {
      const current = await getNote(note.id).catch(() => queued?.theirs ?? null);
      await resolveEntry(note.id, 'theirs');
      return current;
    },
    onSuccess: (current) => {
      if (!current) return;
      autosave.discard();
      setTitle(current.title);
      setContent(current.content);
      adopt(current);
    },
  });

  // Signing out asks whether everything is saved, and can give the draft up.
  useEffect(
    () =>
      registerUnsavedWork({
        save: async () => {
          await autosave.leave();
          return !autosave.hasPending();
        },
        discard: autosave.discard,
        // The tab is about to be reloaded under the draft: it goes where an unsaved draft goes on leaving.
        putAside: () => {
          const draft = autosave.pendingValue();
          if (draft) farewell?.keep(draft);
        },
      }),
    [autosave, farewell],
  );

  // "Keep mine" and "keep mine, put theirs in the history": save again, on the revision of the conflict.
  const keepMine = (withTheirsInHistory: boolean) => {
    if (!theirs) return;
    setDialog(null);
    if (elsewhere && ownerId) {
      // "Keep mine" replaces the other tab's text only if it is still exactly
      // what the question showed: queued with that text as the parent, any
      // later change there raises the question again. "Keep both" first keeps
      // that text as a note of its own, under an id that stays the same if
      // this is tried again, so a retry makes no second copy.
      const other = elsewhere;
      void (async () => {
        if (withTheirsInHistory) {
          await createOffline(
            ownerId,
            { title: `${savedTitle(other.title)} (from another tab)`, content: other.content },
            keepBothId(other, 'theirs'),
          );
        }
        parent.current = { title: other.title, content: other.content };
        await autosave.retry();
      })();
      return;
    }
    revision.current = theirs.revision;
    keepTheirs.current = withTheirsInHistory;
    void autosave.retry();
  };

  // "Take theirs" fetches the note as it is now. The copy that came with the
  // refused save may be old by the time the choice is made.
  const takeTheirs = useMutation({
    // The other tab's queued text is the newest there is; otherwise the note as the server has it now.
    mutationFn: async (): Promise<Note> =>
      elsewhere ? { ...note, title: savedTitle(elsewhere.title), content: elsewhere.content } : getNote(note.id),
    onSuccess: (current) => {
      keepTheirs.current = false;
      unanswered.current = [];
      autosave.discard();
      setTitle(current.title);
      setContent(current.content);
      if (elsewhere) parent.current = { title: elsewhere.title, content: elsewhere.content };
      else adopt(current);
      setDialog(null);
    },
  });

  const restoreStash = () => {
    if (!stashed) return;
    // Saved on the revision it was written on: if the note has moved on since, the usual question comes up.
    revision.current = stashed.revision;
    stashInEditor.current = true;
    offeredStash.current = false;
    setStashed(null);
    change({ title: stashed.title, content: stashed.content });
  };

  const discardStash = () => {
    if (ownerId) dropStash(ownerId, note.id);
    offeredStash.current = false;
    setStashed(null);
  };

  const change = (next: Partial<Draft>) => {
    const draft = { title, content, ...next };
    if (next.title !== undefined) setTitle(next.title);
    if (next.content !== undefined) setContent(next.content);
    autosave.schedule(draft);
  };

  // The quick switcher is used from the keyboard, so it asks for the cursor to land in the text.
  // In preview mode there is no text field, and the preview takes the focus so the keys scroll it.
  const focusText = (location.state as { focusEditor?: boolean } | null)?.focusEditor === true;
  useEffect(() => {
    if (focusText) (textareaRef.current ?? previewRef.current)?.focus();
  }, [focusText]);
  // A note made from a template starts untitled, so its title is the first thing to write.
  const focusTitle = (location.state as { focusTitle?: boolean } | null)?.focusTitle === true;
  useEffect(() => {
    if (!focusTitle) return;
    titleRef.current?.focus();
    titleRef.current?.select();
  }, [focusTitle]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (autosave.hasPending()) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [autosave]);

  // Pin, favourite, notebook and tags save straight away.
  const updateMeta = useMutation({
    mutationFn: (changes: NoteChanges) => updateNote(note.id, changes),
    onMutate: (changes) => {
      queryClient.setQueryData<Note>(['note', note.id], (old) => (old ? { ...old, ...changes } : old));
    },
    onSuccess: (saved, changes) => {
      // The cached text goes with the cached revision: neither is taken from this answer.
      queryClient.setQueryData<Note>(['note', note.id], (old) =>
        old ? { ...saved, title: old.title, content: old.content, revision: old.revision } : saved,
      );
      refreshLists();
      // A template is no backlink and no link suggestion, and a note again is both.
      if (changes.isTemplate !== undefined) {
        void queryClient.invalidateQueries({ queryKey: ['backlinks'] });
        void queryClient.invalidateQueries({ queryKey: ['titles'] });
      }
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ['note', note.id] }),
  });

  const trash = useMutation({
    mutationFn: async () => {
      await autosave.leave();
      await trashNote(note.id);
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['note', note.id] });
      void queryClient.invalidateQueries({ queryKey: ['trash'] });
      void queryClient.invalidateQueries({ queryKey: ['backlinks'] });
      refreshLists();
      navigate({ pathname: '/notes', search: location.search });
    },
  });

  // A copy, or a note made from this template, is opened as soon as it is there.
  const openNew = (created: Note, fromTemplate = false) => {
    refreshLists();
    navigate(
      {
        pathname: `/notes/${created.id}`,
        search: created.isTemplate ? location.search : leavingTemplates(location.search),
      },
      { state: fromTemplate ? { focusTitle: true } : null },
    );
  };

  const duplicate = useMutation({
    mutationFn: async () => {
      // The copy is made on the server, so what is typed here has to be there first.
      await autosave.flush();
      if (autosave.hasPending()) throw new Error('Your latest changes are not saved yet, so the note was not copied.');
      return duplicateNote(note.id);
    },
    onSuccess: openNew,
  });

  // A note can be the daily note only because its title was the day. This lets it go.
  const releaseDaily = useMutation({
    mutationFn: () => releaseDailyNote(note.id),
    onSuccess: (saved) => {
      queryClient.setQueryData<Note>(['note', note.id], (old) => (old ? { ...old, dailyDate: saved.dailyDate } : old));
    },
  });

  const useTemplate = useMutation({
    mutationFn: async () => {
      await autosave.flush();
      if (autosave.hasPending()) throw new Error('Your latest changes are not saved yet, so no note was made.');
      const { notebookId } = newNoteFor(readFilters(new URLSearchParams(location.search)));
      return createNote(fromTemplate(note.id, notebookId));
    },
    onSuccess: (created) => openNew(created, true),
  });

  // Links point at titles, so a rename leaves the links to the old title
  // leading nowhere. `linkedTitle` is the title they point at: the one the
  // note was opened with, until the links are updated. The title autosaves
  // while it is typed, so the title before the last save would not do.
  const [linkedTitle, setLinkedTitle] = useState(note.title);
  const [declinedFor, setDeclinedFor] = useState<string | null>(null);
  const [titleFocused, setTitleFocused] = useState(false);
  /** How many notes the last update had to leave with their old links. */
  const [skipped, setSkipped] = useState(0);
  const renamed = !readOnly && normalizeTitle(note.title) !== normalizeTitle(linkedTitle);
  // Nothing is offered for a title that is still being typed. It has to be
  // out of the field, saved as it stands there, and a title at all: an empty
  // field is saved as "Untitled", which is nothing to point links at.
  const titleSettled = !titleFocused && savedTitle(title) === note.title && note.title !== DEFAULT_TITLE;
  const offering = renamed && titleSettled && declinedFor !== note.title;
  const orphaned = useQuery({
    queryKey: ['rename-links', note.id, linkedTitle, note.title],
    queryFn: () => orphanedLinkCount(note.id, linkedTitle),
    enabled: renamed && titleSettled,
    // Keeps the offer steady when the title is changed once more.
    placeholderData: (previous, query) => (query?.queryKey[2] === linkedTitle ? previous : undefined),
  });
  const orphanedCount = offering ? (orphaned.data?.count ?? 0) : 0;

  const updateLinks = useMutation({
    mutationFn: async () => {
      // The links get the title the server has, so it needs the one on screen first.
      await autosave.flush();
      if (autosave.hasPending()) throw new Error('The note could not be saved, so the links were left as they are.');
      return renameLinks(note.id, linkedTitle);
    },
    onSuccess: (result) => {
      // An editor takes its text from the cached note when it opens, and a
      // refetch does not reach text that is already in an editor. A rewritten
      // note left in the cache would come back with its old links and save
      // them again, so those notes are dropped, not just marked as stale.
      for (const id of result.noteIds) {
        queryClient.removeQueries({ queryKey: ['note', id] });
      }
      // With notes left behind, the links are not all on the new title yet and the offer stays.
      setSkipped(result.skipped);
      if (result.skipped === 0) setLinkedTitle(result.title);
      for (const key of ['notes', 'links', 'backlinks', 'versions', 'search', 'rename-links']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });

  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });
  const links = useQuery({ queryKey: ['links', note.id], queryFn: () => outgoingLinks(note.id) });
  const missingTitles = useMemo(
    () => new Set((links.data ?? []).filter((l) => l.noteId === null).map((l) => normalizeTitle(l.title))),
    [links.data],
  );

  const linkQuery = useDebouncedValue(link?.query ?? null, 150);
  const suggestions = useQuery({
    queryKey: ['titles', linkQuery],
    queryFn: () => noteTitles(linkQuery ?? ''),
    enabled: linkQuery !== null,
  });
  const titleOptions = (suggestions.data ?? []).filter((item) => item.id !== note.id);
  // The suggestions leave templates out, but a link to a template's title
  // still leads to it, so "New note" is offered only for a title that leads
  // nowhere. Until that is known it is not offered.
  const linkTarget = useQuery({
    queryKey: ['resolve', linkQuery === null ? null : normalizeTitle(linkQuery)],
    queryFn: async () => {
      try {
        return (await resolveTitle(linkQuery ?? '')).id;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: linkQuery !== null && linkQuery.trim() !== '',
  });
  const titleTaken = !(linkTarget.isSuccess && linkTarget.data === null && linkQuery === (link?.query ?? null));
  const {
    activeIndex: activeSuggestion,
    setActiveIndex: setActiveSuggestion,
    onArrowKey,
  } = useActiveOption(link ? suggestionCount(titleOptions, link.query, titleTaken) : 0);
  const suggesting = link !== null && suggestionCount(titleOptions, link.query, titleTaken) > 0;

  const openWikiLink = useCallback(
    async (target: string) => {
      await autosave.flush();
      try {
        const found = await resolveTitle(target);
        navigate({ pathname: `/notes/${found.id}`, search: location.search });
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
        const created = await createNote({ title: target, notebookId: note.notebookId });
        refreshLists();
        void queryClient.invalidateQueries({ queryKey: ['links'] });
        navigate({ pathname: `/notes/${created.id}`, search: location.search });
      }
    },
    [autosave, navigate, location.search, note.notebookId, queryClient, refreshLists],
  );

  const updateLinkState = (text: string, cursor: number) => {
    const next = openLinkAt(text, cursor);
    setLink(next);
    if (next?.query !== link?.query) setActiveSuggestion(0);
  };

  const insertLink = (target: string) => {
    const textarea = textareaRef.current;
    if (!textarea || !link) return;
    const cursor = textarea.selectionStart;
    const after = content.slice(cursor);
    const rest = after.startsWith(']]') ? after.slice(2) : after;
    const inserted = `[[${target}]]`;
    const next = content.slice(0, link.start) + inserted + rest;
    change({ content: next });
    setLink(null);
    const position = link.start + inserted.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(position, position);
    });
  };

  const onToggleTask = (line: number, checked: boolean) => {
    const next = toggleTask(content, line, checked);
    if (next === content) return;
    // Replacing the text moves the caret in the source to the end. The text
    // is as long as it was, so the selection goes back where it was. That has
    // to happen before the next click reads it, so the new text is written
    // right here and not on the next frame.
    const textarea = textareaRef.current;
    const selection = textarea && ([textarea.selectionStart, textarea.selectionEnd] as const);
    flushSync(() => change({ content: next }));
    if (textarea && selection) textarea.setSelectionRange(...selection);
  };

  const onContentChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    change({ content: event.target.value });
    updateLinkState(event.target.value, event.target.selectionStart);
  };

  const onContentKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!link) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setLink(null);
    } else if (onArrowKey(event)) {
      return;
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      const target = suggestionAt(titleOptions, link.query, activeSuggestion, titleTaken);
      if (target) {
        event.preventDefault();
        insertLink(target);
      }
    }
  };

  const cycleMode = useCallback(() => {
    setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? 'split');
  }, [mode, setMode]);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        // With a conflict open there is nothing to send before it is settled.
        if (autosave.status === 'conflict') setDialog('conflict');
        else void autosave.flush();
      } else if (mod && event.key.toLowerCase() === 'e') {
        event.preventDefault();
        cycleMode();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [autosave, cycleMode]);

  const words = countWords(content);
  const statusText = {
    saved: queued
      ? 'Kept on this device, to be sent when the server can be reached'
      : `Saved ${formatRelative(note.updatedAt)}`,
    pending: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Could not save. Retrying on the next change.',
    conflict: 'Not saved. This note was changed somewhere else.',
  }[autosave.status];

  return (
    <article className={`editor editor-${mode}`} aria-label="Note editor">
      {readOnly && <div className="banner">This note is in the trash. Restore it from the trash to edit it again.</div>}
      <div className="editor-toolbar">
        <NotebookSelect
          notebooks={notebooks.data ?? []}
          value={note.notebookId}
          disabled={readOnly}
          onChange={(notebookId) => {
            const through = newlyPublicThrough(notebooks.data ?? [], notebookId, note.sharedThrough);
            if (through && notebookId) setPublicMove({ notebookId, through });
            else updateMeta.mutate({ notebookId });
          }}
        />
        <div className="toolbar-group" role="group" aria-label="View">
          {MODES.map((value) => (
            <button
              key={value}
              type="button"
              className={mode === value ? 'segment active' : 'segment'}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="toolbar-spacer" />
        <button
          type="button"
          className={note.pinned ? 'icon-button toggled' : 'icon-button'}
          aria-pressed={note.pinned}
          aria-label={note.pinned ? 'Unpin' : 'Pin'}
          title={note.pinned ? 'Unpin' : 'Pin to the top'}
          disabled={readOnly}
          onClick={() => updateMeta.mutate({ pinned: !note.pinned })}
        >
          <PinIcon filled={note.pinned} />
        </button>
        <button
          type="button"
          className={note.favorite ? 'icon-button toggled' : 'icon-button'}
          aria-pressed={note.favorite}
          aria-label={note.favorite ? 'Remove from favourites' : 'Add to favourites'}
          title={note.favorite ? 'Remove from favourites' : 'Add to favourites'}
          disabled={readOnly}
          onClick={() => updateMeta.mutate({ favorite: !note.favorite })}
        >
          {note.favorite ? '★' : '☆'}
        </button>
        <button type="button" className="button" onClick={() => setDialog('history')}>
          History
        </button>
        <button
          type="button"
          className={note.shared ? 'button button-shared' : 'button'}
          disabled={readOnly}
          onClick={() => setDialog('share')}
        >
          {note.shared ? 'Shared' : 'Share'}
        </button>
        <button
          type="button"
          className="button"
          title="Download as Markdown"
          onClick={() => void autosave.flush().then(() => exportNote(note.id, title))}
        >
          Export
        </button>
        <button
          type="button"
          className="button"
          title="Make a copy of this note"
          disabled={readOnly || duplicate.isPending}
          onClick={() => duplicate.mutate()}
        >
          Duplicate
        </button>
        {note.dailyDate && !readOnly && (
          <button
            type="button"
            className="button"
            title={`This is the daily note of ${note.dailyDate}. Make it an ordinary note, and "Today" starts a new one.`}
            disabled={releaseDaily.isPending}
            onClick={() => releaseDaily.mutate()}
          >
            Not the daily note
          </button>
        )}
        <button
          type="button"
          className={note.isTemplate ? 'button button-shared' : 'button'}
          aria-pressed={note.isTemplate}
          title={note.isTemplate ? 'Make this an ordinary note again' : 'Use this note as a template for new notes'}
          disabled={readOnly}
          onClick={() => updateMeta.mutate({ isTemplate: !note.isTemplate })}
        >
          Template
        </button>
        {!readOnly && (
          <button type="button" className="button button-danger-quiet" onClick={() => setDialog('delete')}>
            Delete
          </button>
        )}
      </div>

      <input
        ref={titleRef}
        className="title-input"
        aria-label="Title"
        placeholder="Untitled"
        value={title}
        maxLength={200}
        readOnly={readOnly}
        onChange={(event) => change({ title: event.target.value })}
        onFocus={() => setTitleFocused(true)}
        onBlur={() => setTitleFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            textareaRef.current?.focus();
          }
        }}
      />
      <TagInput
        tags={note.tags}
        suggestions={(tags.data ?? []).map((tag) => tag.name)}
        disabled={readOnly}
        onChange={(next) => updateMeta.mutate({ tags: next })}
      />
      {note.isTemplate && !readOnly && (
        <div className="banner banner-info">
          <span>
            This is a template. It stays out of the lists and the search, and new notes start from it with{' '}
            <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code> and <code>{'{{title}}'}</code> filled in.
          </span>
          <button
            type="button"
            className="button button-primary"
            disabled={useTemplate.isPending}
            onClick={() => useTemplate.mutate()}
          >
            New note from this template
          </button>
        </div>
      )}
      {(duplicate.error || useTemplate.error || releaseDaily.error) && (
        <ErrorMessage error={duplicate.error ?? useTemplate.error ?? releaseDaily.error} />
      )}
      {note.sharedThrough && !readOnly && (
        <p className="shared-through muted">
          Anyone with the link to the shared notebook “{note.sharedThrough.name}” can read this note.
        </p>
      )}
      {stashed && !readOnly && (
        <div className="banner banner-info" role="status">
          <span>
            Changes to this note from {formatDateTime(stashed.at)} could not be saved before you left it. They are kept
            in this tab.
          </span>
          <button type="button" className="button button-primary" onClick={restoreStash}>
            Put them back
          </button>
          <button type="button" className="button" onClick={discardStash}>
            Discard them
          </button>
        </div>
      )}
      {autosave.status === 'conflict' && dialog !== 'conflict' && (
        <div className="banner banner-info" role="alert">
          <span>This note was changed somewhere else, and what you typed here is not saved.</span>
          <button type="button" className="button button-primary" onClick={() => setDialog('conflict')}>
            Decide what to keep
          </button>
        </div>
      )}
      {offering && (orphanedCount > 0 || skipped > 0) && (
        <div className="banner banner-info" role="status">
          {orphanedCount > 0 && (
            <span>
              {orphanedCount === 1 ? '1 note still links' : `${orphanedCount} notes still link`} to [[{linkedTitle}]],
              the title this note had before.
            </span>
          )}
          {skipped > 0 && (
            <span>
              {skipped === 1 ? '1 note was left as it is' : `${skipped} notes were left as they are`}, with the link to
              [[{linkedTitle}]]: changed while the links were updated, or too long to take the new title.
            </span>
          )}
          {orphanedCount > 0 && (
            <button
              type="button"
              className="button button-primary"
              disabled={updateLinks.isPending}
              onClick={() => updateLinks.mutate()}
            >
              {updateLinks.isPending
                ? 'Updating…'
                : `Update ${orphanedCount} ${orphanedCount === 1 ? 'link' : 'links'} from [[${linkedTitle}]] to [[${note.title}]]`}
            </button>
          )}
          <button
            type="button"
            className="button"
            onClick={() => {
              setDeclinedFor(note.title);
              setSkipped(0);
            }}
          >
            {orphanedCount > 0 ? 'Not now' : 'Dismiss'}
          </button>
          {updateLinks.error && <ErrorMessage error={updateLinks.error} />}
        </div>
      )}

      <div className="editor-panes">
        {mode !== 'preview' && (
          <div className="editor-source">
            <textarea
              ref={textareaRef}
              aria-label="Note content"
              aria-autocomplete="list"
              aria-controls={suggesting ? SUGGESTIONS_ID : undefined}
              aria-activedescendant={suggesting ? suggestionId(activeSuggestion) : undefined}
              placeholder="Write in Markdown. Type [[ to link to another note."
              value={content}
              readOnly={readOnly}
              spellCheck
              onChange={onContentChange}
              onKeyDown={onContentKeyDown}
              onClick={(event) => updateLinkState(content, event.currentTarget.selectionStart)}
              onBlur={() => setLink(null)}
            />
            {link && (
              <LinkSuggestions
                titles={titleOptions}
                query={link.query}
                taken={titleTaken}
                activeIndex={activeSuggestion}
                onPick={insertLink}
              />
            )}
          </div>
        )}
        {mode === 'edit' && printing && (
          <div className="editor-preview print-only">
            <MarkdownPreview content={content} missingTitles={missingTitles} />
          </div>
        )}
        {mode !== 'edit' && (
          <div className="editor-preview" aria-label="Preview" ref={previewRef} tabIndex={-1}>
            <MarkdownPreview
              content={content}
              onWikiLink={openWikiLink}
              missingTitles={missingTitles}
              onToggleTask={readOnly ? undefined : onToggleTask}
            />
          </div>
        )}
      </div>

      <footer className="editor-footer">
        <span
          className={
            autosave.status === 'error' || autosave.status === 'conflict' ? 'save-status error' : 'save-status'
          }
          role="status"
        >
          {statusText}
        </span>
        <span className="muted">
          {words.toLocaleString()} {words === 1 ? 'word' : 'words'}
          {words > 0 && ` · ${readingMinutes(words)} min read`} · created {formatDateTime(note.createdAt)}
        </span>
      </footer>

      <BacklinksPanel noteId={note.id} />

      {dialog === 'history' && (
        <VersionHistoryDialog
          noteId={note.id}
          current={{ title, content }}
          onClose={() => setDialog(null)}
          beforeRestore={async () => {
            // A restore replaces what is in the editor. Saved first, that text
            // is on the server, where the restore keeps it as a version.
            await autosave.flush();
            if (autosave.hasPending()) {
              throw new Error('Your latest changes are not saved yet, so nothing was restored. Save them first.');
            }
          }}
          onRestored={(restored) => {
            setTitle(restored.title);
            setContent(restored.content);
            adopt(restored);
            refreshLists();
          }}
        />
      )}
      {savedElsewhere && !readOnly && (
        <div className="banner banner-info" role="status">
          <span>
            Another tab sent changes to this note that are not shown here. Your next change asks before it replaces
            anything.
          </span>
        </div>
      )}
      {queued?.state === 'conflict' && !queuedQuestionClosed && (
        <ConflictDialog
          onKeepBoth={() => void resolveEntry(note.id, 'both')}
          onKeepMine={() => void resolveEntry(note.id, 'mine')}
          onTakeTheirs={() => takeTheirsQueued.mutate()}
          busy={takeTheirsQueued.isPending}
          error={takeTheirsQueued.error}
          onClose={() => setQueuedQuestionClosed(true)}
        />
      )}
      {queued?.state === 'conflict' && queuedQuestionClosed && (
        <div className="banner banner-info" role="alert">
          <span>
            Changes made here without a connection meet a newer version of this note. Nothing is sent until you decide.
          </span>
          <button type="button" className="button button-primary" onClick={() => setQueuedQuestionClosed(false)}>
            Decide what to keep
          </button>
        </div>
      )}
      {queued?.state === 'stuck' && (
        <div className="banner banner-info" role="alert">
          <span>Changes made here without a connection could not be sent: {queued.problem}</span>
        </div>
      )}
      {dialog === 'conflict' && theirs && (
        <ConflictDialog
          onKeepBoth={() => keepMine(true)}
          onKeepMine={() => keepMine(false)}
          onTakeTheirs={() => takeTheirs.mutate()}
          busy={takeTheirs.isPending}
          error={takeTheirs.error}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'share' && <ShareDialog noteId={note.id} onClose={() => setDialog(null)} />}
      {publicMove && (
        <ConfirmDialog
          title="Make this note public?"
          message={
            <p>
              “{publicMove.through.name}” is shared with a link. Moved there, “{savedTitle(title)}” can be read by
              anyone who has that link.
            </p>
          }
          confirmLabel="Move it"
          onConfirm={() => {
            updateMeta.mutate({ notebookId: publicMove.notebookId });
            setPublicMove(null);
          }}
          onCancel={() => setPublicMove(null)}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title="Move to trash?"
          message={<p>“{savedTitle(title)}” will be moved to the trash. You can restore it from there for 30 days.</p>}
          confirmLabel="Move to trash"
          danger
          busy={trash.isPending}
          onConfirm={() => trash.mutate()}
          onCancel={() => setDialog(null)}
        />
      )}
    </article>
  );
}
