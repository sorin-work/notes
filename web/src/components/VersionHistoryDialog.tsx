import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Note } from '../api/types';
import { getVersion, listVersions, restoreVersion } from '../api/versions';
import { formatDateTime, formatRelative } from '../lib/dates';
import { MarkdownPreview } from './MarkdownPreview';
import { Modal } from './Modal';
import { ErrorMessage, NeedsConnection, Spinner } from './States';
import { VersionChanges } from './VersionChanges';

interface Props {
  noteId: string;
  /** Title and text as they are in the editor, saved or not. Versions are compared with these. */
  current: { title: string; content: string };
  /** Runs before a restore. When it fails, nothing is restored and its error is shown. */
  beforeRestore?(): Promise<void>;
  onClose(): void;
  onRestored(note: Note): void;
}

const VIEWS = ['preview', 'changes'] as const;
const VIEW_LABELS: Record<(typeof VIEWS)[number], string> = { preview: 'Preview', changes: 'Changes' };

export function VersionHistoryDialog({ noteId, current, beforeRestore, onClose, onRestored }: Props) {
  const versions = useQuery({ queryKey: ['versions', noteId], queryFn: () => listVersions(noteId) });
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<(typeof VIEWS)[number]>('preview');
  const selectedId = selected ?? versions.data?.[0]?.id ?? null;

  const version = useQuery({
    queryKey: ['version', noteId, selectedId],
    queryFn: () => getVersion(noteId, selectedId as string),
    enabled: selectedId !== null,
  });

  const restore = useMutation({
    mutationFn: async () => {
      await beforeRestore?.();
      return restoreVersion(noteId, selectedId as string);
    },
    onSuccess: (note) => {
      onRestored(note);
      onClose();
    },
  });

  return (
    <Modal title="Version history" onClose={onClose} wide>
      {versions.isPending && versions.fetchStatus === 'paused' && (
        <NeedsConnection>The history of a note needs a connection.</NeedsConnection>
      )}
      {versions.isLoading && <Spinner />}
      {versions.error && <ErrorMessage error={versions.error} />}
      {versions.data?.length === 0 && (
        <p className="muted">No earlier versions yet. A version is saved while you edit, at most every ten minutes.</p>
      )}
      {versions.data && versions.data.length > 0 && (
        <div className="history">
          <ul className="history-list" aria-label="Versions">
            {versions.data.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={item.id === selectedId ? 'history-item active' : 'history-item'}
                  aria-current={item.id === selectedId}
                  onClick={() => setSelected(item.id)}
                >
                  <span className="history-date" title={formatDateTime(item.createdAt)}>
                    {formatRelative(item.createdAt)}
                  </span>
                  <span className="history-meta">
                    {item.title} · {item.characters.toLocaleString()} characters
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="history-preview">
            {version.isLoading && <Spinner />}
            {version.data && (
              <>
                <div className="history-preview-header">
                  <div>
                    <strong>{version.data.title}</strong>
                    <div className="muted">{formatDateTime(version.data.createdAt)}</div>
                  </div>
                  <div className="history-actions">
                    <div className="toolbar-group" role="group" aria-label="Show">
                      {VIEWS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className={view === value ? 'segment active' : 'segment'}
                          aria-pressed={view === value}
                          onClick={() => setView(value)}
                        >
                          {VIEW_LABELS[value]}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => restore.mutate()}
                      disabled={restore.isPending}
                    >
                      {restore.isPending ? 'Restoring…' : 'Restore this version'}
                    </button>
                  </div>
                </div>
                {restore.error && <ErrorMessage error={restore.error} />}
                {view === 'preview' ? (
                  <MarkdownPreview content={version.data.content} />
                ) : (
                  <VersionChanges version={version.data} current={current} />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
