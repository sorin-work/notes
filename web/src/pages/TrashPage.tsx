import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { deleteForever, emptyTrash, listTrash, restoreNote } from '../api/trash';
import type { TrashedNote } from '../api/types';
import { ConfirmDialog } from '../components/Modal';
import { EmptyState, ErrorMessage, Spinner } from '../components/States';
import { formatRelative } from '../lib/dates';

export function TrashPage() {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<TrashedNote | 'all' | null>(null);
  const trash = useQuery({ queryKey: ['trash'], queryFn: listTrash });

  const refresh = () => {
    for (const key of ['trash', 'notes', 'notebooks', 'tags', 'backlinks', 'links']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
  const restore = useMutation({ mutationFn: restoreNote, onSuccess: refresh });
  const remove = useMutation({
    mutationFn: deleteForever,
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });
  const empty = useMutation({
    mutationFn: emptyTrash,
    onSuccess: () => {
      setConfirm(null);
      refresh();
    },
  });

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Trash</h1>
        </div>
        {trash.data && trash.data.length > 0 && (
          <button type="button" className="button button-danger" onClick={() => setConfirm('all')}>
            Empty trash
          </button>
        )}
      </header>
      {trash.isLoading && <Spinner />}
      {trash.error && <ErrorMessage error={trash.error} />}
      {(restore.error || remove.error) && <ErrorMessage error={restore.error ?? remove.error} />}
      {trash.data?.length === 0 && <EmptyState title="The trash is empty" />}
      <ul className="trash-list">
        {trash.data?.map((note) => (
          <li key={note.id} className="trash-item">
            <div>
              <strong>{note.title}</strong>
              {note.notebook && <span className="muted"> in {note.notebook.name}</span>}
              {note.excerpt && <p className="note-item-excerpt">{note.excerpt}</p>}
              <span className="muted">Deleted {formatRelative(note.deletedAt)}</span>
            </div>
            <div className="trash-actions">
              <button
                type="button"
                className="button"
                onClick={() => restore.mutate(note.id)}
                disabled={restore.isPending}
              >
                Restore
              </button>
              <button type="button" className="button button-danger-quiet" onClick={() => setConfirm(note)}>
                Delete forever
              </button>
            </div>
          </li>
        ))}
      </ul>
      {confirm && (
        <ConfirmDialog
          title={confirm === 'all' ? 'Empty the trash?' : 'Delete forever?'}
          message={
            <p>
              {confirm === 'all'
                ? `All ${trash.data?.length ?? 0} notes in the trash will be deleted, with their history. This cannot be undone.`
                : `“${confirm.title}” and its history will be deleted. This cannot be undone.`}
            </p>
          }
          confirmLabel={confirm === 'all' ? 'Empty trash' : 'Delete forever'}
          danger
          busy={remove.isPending || empty.isPending}
          onConfirm={() => (confirm === 'all' ? empty.mutate() : remove.mutate(confirm.id))}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
