import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { listNotebooks } from '../api/notebooks';
import { getNote, trashNote, updateNote } from '../api/notes';
import { listTags } from '../api/tags';
import type { Note, NoteChanges } from '../api/types';
import { useAutosave } from '../hooks/useAutosave';
import { useStoredState } from '../hooks/useStoredState';
import { formatRelative } from '../lib/dates';
import { MarkdownPreview } from './MarkdownPreview';
import { ConfirmDialog } from './Modal';
import { NotebookSelect } from './NotebookSelect';
import { ErrorMessage, Spinner } from './States';
import { TagInput } from './TagInput';

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

  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [mode, setMode] = useStoredState<Mode>('notes.editorMode', MODES, 'split');
  const [dialog, setDialog] = useState<'delete' | null>(null);

  const refreshLists = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
  }, [queryClient]);

  const saveDraft = useCallback(
    async (draft: Draft) => {
      const saved = await updateNote(note.id, draft);
      queryClient.setQueryData(['note', note.id], saved);
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
    [note.id, queryClient],
  );
  const autosave = useAutosave(saveDraft);

  const change = (next: Partial<Draft>) => {
    const draft = { title, content, ...next };
    if (next.title !== undefined) setTitle(next.title);
    if (next.content !== undefined) setContent(next.content);
    autosave.schedule(draft);
  };

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
      queryClient.setQueryData<Note>(['note', note.id], (old) =>
        old ? { ...saved, title: old.title, content: old.content } : saved,
      );
      refreshLists();
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: ['note', note.id] }),
  });

  const trash = useMutation({
    mutationFn: async () => {
      await autosave.flush();
      await trashNote(note.id);
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['note', note.id] });
      void queryClient.invalidateQueries({ queryKey: ['trash'] });
      refreshLists();
      navigate({ pathname: '/notes', search: location.search });
    },
  });

  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });
  const statusText = {
    saved: `Saved ${formatRelative(note.updatedAt)}`,
    pending: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Could not save. Retrying on the next change.',
  }[autosave.status];

  return (
    <article className={`editor editor-${mode}`} aria-label="Note editor">
      <div className="editor-toolbar">
        <NotebookSelect
          notebooks={notebooks.data ?? []}
          value={note.notebookId}
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
          onClick={() => updateMeta.mutate({ pinned: !note.pinned })}
        >
          📌
        </button>
        <button
          type="button"
          className={note.favorite ? 'icon-button toggled' : 'icon-button'}
          aria-pressed={note.favorite}
          aria-label={note.favorite ? 'Remove from favourites' : 'Add to favourites'}
          title={note.favorite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => updateMeta.mutate({ favorite: !note.favorite })}
        >
          {note.favorite ? '★' : '☆'}
        </button>
        <button type="button" className="button button-danger-quiet" onClick={() => setDialog('delete')}>
          Delete
        </button>
      </div>

      <input
        className="title-input"
        aria-label="Title"
        placeholder="Untitled"
        value={title}
        maxLength={200}
        onChange={(event) => change({ title: event.target.value })}
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
        onChange={(next) => updateMeta.mutate({ tags: next })}
      />

      <div className="editor-panes">
        {mode !== 'preview' && (
          <div className="editor-source">
            <textarea
              ref={textareaRef}
              aria-label="Note content"
              placeholder="Write in Markdown."
              value={content}
              spellCheck
              onChange={(event) => change({ content: event.target.value })}
            />
          </div>
        )}
        {mode !== 'edit' && (
          <div className="editor-preview" aria-label="Preview">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>

      <footer className="editor-footer">
        <span className={autosave.status === 'error' ? 'save-status error' : 'save-status'} role="status">
          {statusText}
        </span>
      </footer>

      {dialog === 'delete' && (
        <ConfirmDialog
          title="Move to trash?"
          message={
            <p>“{title || 'Untitled'}” will be moved to the trash. You can restore it from there for 30 days.</p>
          }
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
