import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { getNote, updateNote } from '../api/notes';
import type { Note } from '../api/types';
import { useAutosave } from '../hooks/useAutosave';
import { formatRelative } from '../lib/dates';
import { MarkdownPreview } from './MarkdownPreview';
import { ErrorMessage, Spinner } from './States';

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [mode, setMode] = useState<Mode>('split');

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

  const statusText = {
    saved: `Saved ${formatRelative(note.updatedAt)}`,
    pending: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Could not save. Retrying on the next change.',
  }[autosave.status];

  return (
    <article className={`editor editor-${mode}`} aria-label="Note editor">
      <div className="editor-toolbar">
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
    </article>
  );
}
