import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChangeEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { listNotebooks } from '../api/notebooks';
import {
  createNote,
  exportNote,
  getNote,
  noteTitles,
  orphanedLinkCount,
  outgoingLinks,
  renameLinks,
  resolveTitle,
  staleNote,
  trashNote,
  updateNote,
} from '../api/notes';
import { listTags } from '../api/tags';
import type { Note, NoteChanges } from '../api/types';
import { useActiveOption } from '../hooks/useActiveOption';
import { useAutosave } from '../hooks/useAutosave';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useStoredState } from '../hooks/useStoredState';
import { formatDateTime, formatRelative } from '../lib/dates';
import { toggleTask } from '../lib/tasks';
import { countWords, DEFAULT_TITLE, readingMinutes, savedTitle } from '../lib/text';
import { normalizeTitle, openLinkAt } from '../lib/wikilinks';
import { BacklinksPanel } from './BacklinksPanel';
import { ConflictDialog } from './ConflictDialog';
import { PinIcon } from './Icons';
import { LinkSuggestions, suggestionAt, suggestionCount } from './LinkSuggestions';
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

function LoadedEditor({ note }: { note: Note }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [mode, setMode] = useStoredState<Mode>('notes.editorMode', MODES, 'split');
  const [dialog, setDialog] = useState<'history' | 'share' | 'delete' | 'conflict' | null>(null);
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
  const revision = useRef(note.revision);
  // Set by "keep mine, put theirs in the history" for the save that follows.
  const keepTheirs = useRef(false);

  const adopt = useCallback(
    (saved: Note) => {
      revision.current = saved.revision;
      queryClient.setQueryData(['note', note.id], saved);
      void queryClient.invalidateQueries({ queryKey: ['links', note.id] });
      void queryClient.invalidateQueries({ queryKey: ['backlinks'] });
      void queryClient.invalidateQueries({ queryKey: ['versions', note.id] });
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    [note.id, queryClient],
  );

  const saveDraft = useCallback(
    async (draft: Draft) => {
      const changes = { ...draft, revision: revision.current, keepVersion: keepTheirs.current || undefined };
      try {
        adopt(await updateNote(note.id, changes));
      } catch (error) {
        // The server can already hold exactly this text, for one when the
        // answer to an earlier save got lost. Then there is nothing to decide.
        const theirs = staleNote(error);
        if (!theirs || theirs.title !== savedTitle(draft.title) || theirs.content !== draft.content) throw error;
        adopt(theirs);
      }
      keepTheirs.current = false;
    },
    [note.id, adopt],
  );

  // Leaving the note with a conflict still open must not drop anything, and
  // there is nobody left to ask. The draft is saved and the other text goes
  // into the history. Should the note change yet again meanwhile, try anew.
  const saveOverConflict = useCallback(
    async (draft: Draft, conflict: unknown) => {
      let theirs = staleNote(conflict);
      for (let attempt = 0; ; attempt++) {
        try {
          return adopt(await updateNote(note.id, { ...draft, revision: theirs?.revision, keepVersion: true }));
        } catch (error) {
          theirs = staleNote(error);
          if (!theirs || attempt === 2) throw error;
        }
      }
    },
    [note.id, adopt],
  );

  const autosave = useAutosave(saveDraft, undefined, {
    isConflict: (error) => staleNote(error) !== null,
    onConflict: () => setDialog('conflict'),
    saveOver: saveOverConflict,
  });
  const theirs = staleNote(autosave.conflict);

  const resolveConflict = (choice: 'both' | 'mine' | 'theirs') => {
    if (!theirs) return;
    setDialog(null);
    revision.current = theirs.revision;
    if (choice === 'theirs') {
      autosave.discard();
      setTitle(theirs.title);
      setContent(theirs.content);
      adopt(theirs);
    } else {
      keepTheirs.current = choice === 'both';
      void autosave.retry();
    }
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
    onSuccess: (saved) => {
      // The cached text goes with the cached revision: neither is taken from this answer.
      queryClient.setQueryData<Note>(['note', note.id], (old) =>
        old ? { ...saved, title: old.title, content: old.content, revision: old.revision } : saved,
      );
      refreshLists();
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
  const {
    activeIndex: activeSuggestion,
    setActiveIndex: setActiveSuggestion,
    onArrowKey,
  } = useActiveOption(link ? suggestionCount(titleOptions, link.query) : 0);

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
      const target = suggestionAt(titleOptions, link.query, activeSuggestion);
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
    saved: `Saved ${formatRelative(note.updatedAt)}`,
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
          onChange={(notebookId) => updateMeta.mutate({ notebookId })}
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
        {!readOnly && (
          <button type="button" className="button button-danger-quiet" onClick={() => setDialog('delete')}>
            Delete
          </button>
        )}
      </div>

      <input
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
                activeIndex={activeSuggestion}
                onPick={insertLink}
              />
            )}
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
      {dialog === 'conflict' && theirs && (
        <ConflictDialog
          onKeepBoth={() => resolveConflict('both')}
          onKeepMine={() => resolveConflict('mine')}
          onTakeTheirs={() => resolveConflict('theirs')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'share' && <ShareDialog noteId={note.id} onClose={() => setDialog(null)} />}
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
