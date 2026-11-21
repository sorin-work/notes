import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BulkAction, BulkResult, BulkSkipReason, bulkNotes } from '../api/notes';
import type { Notebook } from '../api/types';
import { useOnline } from '../hooks/useOnline';
import { flattenTree, notebookLabel, notebookTree, ownNotebooks } from '../lib/notebooks';
import { openEntryFor } from '../lib/outbox';
import { newlyPublicThrough } from '../lib/sharing';
import { ConfirmDialog } from './Modal';
import { ErrorMessage } from './States';

interface Props {
  selected: string[];
  /** How many notes are loaded, for "Select all". */
  loaded: number;
  notebooks: Notebook[];
  onSelectAll(): void;
  onClear(): void;
}

/** How long a move can be undone from the notice. */
export const UNDO_MS = 15_000;

const REASONS: Record<BulkSkipReason, (n: number) => string> = {
  not_found: (n) => `${n === 1 ? 'was' : 'were'} not found`,
  not_allowed: (n) => `${n === 1 ? 'is' : 'are'} not yours to change that way`,
  in_trash: (n) => `${n === 1 ? 'is' : 'are'} in the trash`,
  too_many_tags: (n) => `already ${n === 1 ? 'has' : 'have'} 20 tags`,
};

const notes = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'note' : 'notes'}`;

/** What a bulk action did, in a sentence or two. */
export function describeResult(done: string, result: BulkResult, waiting: number): string {
  const parts = [`${done} ${notes(result.changed.length)}.`];
  if (result.unchanged.length > 0) {
    parts.push(`${notes(result.unchanged.length)} ${result.unchanged.length === 1 ? 'was' : 'were'} already so.`);
  }
  const counts = new Map<BulkSkipReason, number>();
  for (const skip of result.skipped) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  for (const [reason, n] of counts) parts.push(`${notes(n)} ${REASONS[reason](n)}.`);
  if (waiting > 0) {
    parts.push(`${notes(waiting)} made without a connection ${waiting === 1 ? 'is' : 'are'} not on the server yet.`);
  }
  return parts.join(' ');
}

/**
 * What can be done with the selected notes: move them, add or remove a tag,
 * pin or unpin them, or move them to the trash. Each is one request for all
 * of them, which needs a connection. After a move the notice offers Undo
 * for a while, which moves each note back to where it was.
 */
export function SelectionBar({ selected, loaded, notebooks, onSelectAll, onClear }: Props) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const [tag, setTag] = useState('');
  const [notice, setNotice] = useState<{ text: string; undo?: Record<string, string | null> } | null>(null);
  const [publicMove, setPublicMove] = useState<{ notebookId: string; name: string } | null>(null);
  const targets = useMemo(() => flattenTree(notebookTree(ownNotebooks(notebooks))), [notebooks]);

  // Undo is offered for a while, then the notice stays without it.
  useEffect(() => {
    if (!notice?.undo) return;
    const timer = setTimeout(() => setNotice((now) => (now ? { text: now.text } : now)), UNDO_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const refresh = (ids: string[]) => {
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    for (const id of ids) void queryClient.invalidateQueries({ queryKey: ['note', id] });
  };

  const run = useMutation({
    mutationFn: async ({
      action,
      notebookId,
      done,
    }: {
      action: BulkAction;
      notebookId?: string | null;
      done: string;
    }) => {
      // A note made without a connection and not sent yet has no row on the server to change.
      const waiting = selected.filter((id) => openEntryFor(id)?.kind === 'create');
      const ids = selected.filter((id) => !waiting.includes(id));
      const result =
        ids.length > 0
          ? await bulkNotes({
              ids,
              action,
              notebookId,
              tag: action === 'addTag' || action === 'removeTag' ? tag : undefined,
            })
          : { changed: [], unchanged: [], skipped: [] };
      return { result, done, waiting: waiting.length, action };
    },
    onSuccess: ({ result, done, waiting, action }) => {
      refresh([...result.changed, ...result.unchanged]);
      const undo = action === 'move' && result.changed.length > 0 ? result.previous : undefined;
      setNotice({ text: describeResult(done, result, waiting), undo });
      if (action === 'addTag' || action === 'removeTag') setTag('');
    },
  });

  const undo = useMutation({
    mutationFn: async (previous: Record<string, string | null>) => {
      // One request for each notebook the notes came from.
      const back = new Map<string | null, string[]>();
      for (const [id, notebookId] of Object.entries(previous))
        back.set(notebookId, [...(back.get(notebookId) ?? []), id]);
      const ids: string[] = [];
      for (const [notebookId, group] of back) {
        const result = await bulkNotes({ ids: group, action: 'move', notebookId });
        ids.push(...result.changed);
      }
      return ids;
    },
    onSuccess: (ids) => {
      refresh(ids);
      setNotice({ text: `Moved ${notes(ids.length)} back.` });
    },
  });

  const move = (value: string) => {
    if (!value) return;
    const notebookId = value === 'none' ? null : value;
    const name = notebookId ? (notebookLabel(notebooks, notebookId) ?? 'the notebook') : 'no notebook';
    const through = newlyPublicThrough(notebooks, notebookId, null);
    if (through && notebookId) {
      setPublicMove({ notebookId, name: through.name });
      return;
    }
    run.mutate({
      action: 'move',
      notebookId,
      done: notebookId ? `Moved to “${name}”:` : 'Took out of their notebooks:',
    });
  };

  const tagAction = (action: 'addTag' | 'removeTag') => (event?: FormEvent) => {
    event?.preventDefault();
    if (!tag.trim()) return;
    run.mutate({ action, done: action === 'addTag' ? `Tagged #${tag.trim()}:` : `Took #${tag.trim()} off` });
  };

  const busy = run.isPending || undo.isPending;
  const none = selected.length === 0;
  const off = busy || none || !online;

  return (
    <div className="selection-bar" role="region" aria-label="Selected notes">
      <div className="selection-count">
        <span role="status">{selected.length === 0 ? 'No notes selected' : `${notes(selected.length)} selected`}</span>
        <button type="button" className="link-button" onClick={onSelectAll} disabled={loaded === 0}>
          Select the {loaded.toLocaleString()} loaded
        </button>
        <button type="button" className="link-button" onClick={onClear} disabled={none}>
          Clear
        </button>
      </div>
      {!online && <p className="muted">These actions need a connection.</p>}
      <div className="selection-actions">
        <select aria-label="Move to" value="" disabled={off} onChange={(event) => move(event.target.value)}>
          <option value="">Move to…</option>
          <option value="none">No notebook</option>
          {targets.map((notebook) => (
            <option key={notebook.id} value={notebook.id}>
              {notebookLabel(notebooks, notebook.id)}
            </option>
          ))}
        </select>
        <form className="selection-tag" onSubmit={tagAction('addTag')}>
          <input
            aria-label="Tag"
            placeholder="Tag"
            value={tag}
            maxLength={40}
            onChange={(event) => setTag(event.target.value)}
          />
          <button type="submit" className="button" disabled={off || !tag.trim()}>
            Add tag
          </button>
          <button
            type="button"
            className="button"
            disabled={off || !tag.trim()}
            onClick={() => tagAction('removeTag')()}
          >
            Remove tag
          </button>
        </form>
        <button
          type="button"
          className="button"
          disabled={off}
          onClick={() => run.mutate({ action: 'pin', done: 'Pinned' })}
        >
          Pin
        </button>
        <button
          type="button"
          className="button"
          disabled={off}
          onClick={() => run.mutate({ action: 'unpin', done: 'Unpinned' })}
        >
          Unpin
        </button>
        <button
          type="button"
          className="button button-danger-quiet"
          disabled={off}
          onClick={() => run.mutate({ action: 'trash', done: 'Moved to the trash:' })}
        >
          Move to trash
        </button>
      </div>
      {(run.error || undo.error) && <ErrorMessage error={run.error ?? undo.error} />}
      {notice && (
        <div className="banner banner-info" role="status">
          <span>{notice.text}</span>
          {notice.undo && (
            <button
              type="button"
              className="button"
              disabled={busy || !online}
              onClick={() => notice.undo && undo.mutate(notice.undo)}
            >
              Undo
            </button>
          )}
          <button type="button" className="button" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {publicMove && (
        <ConfirmDialog
          title="Make these notes public?"
          message={
            <p>
              “{publicMove.name}” is shared with a link. Moved there, the selected notes can be read by anyone who has
              that link.
            </p>
          }
          confirmLabel="Move them"
          onConfirm={() => {
            const { notebookId } = publicMove;
            setPublicMove(null);
            run.mutate({
              action: 'move',
              notebookId,
              done: `Moved to “${notebookLabel(notebooks, notebookId) ?? 'the notebook'}”:`,
            });
          }}
          onCancel={() => setPublicMove(null)}
        />
      )}
    </div>
  );
}
