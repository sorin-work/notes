import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useId, useState } from 'react';
import { createNotebook, updateNotebook } from '../api/notebooks';
import type { Notebook } from '../api/types';
import { MAX_NOTEBOOK_DEPTH, possibleParents } from '../lib/notebooks';
import { Modal } from './Modal';
import { INDENT } from './NotebookSelect';
import { ErrorMessage } from './States';

interface Props {
  notebooks: Notebook[];
  /** The notebook to rename or move; omitted when creating one. */
  notebook?: Notebook;
  /** Preselected parent for a new notebook. */
  parentId?: string | null;
  onClose(): void;
  onSaved?(notebook: Notebook): void;
}

export function NotebookDialog({ notebooks, notebook, parentId = null, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(notebook?.name ?? '');
  const [parent, setParent] = useState<string | null>(notebook ? notebook.parentId : parentId);
  // Not itself, nothing inside it, and nowhere that would take it below the last level. The API checks the same.
  const parents = possibleParents(notebooks, notebook ?? null);
  const hintId = useId();

  const save = useMutation({
    mutationFn: () =>
      notebook ? updateNotebook(notebook.id, { name, parentId: parent }) : createNotebook(name, parent),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
      onSaved?.(saved);
      onClose();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) save.mutate();
  };

  return (
    <Modal title={notebook ? 'Edit notebook' : 'New notebook'} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required />
        </label>
        <div className="field">
          <label className="field">
            <span>Inside</span>
            <select
              value={parent ?? ''}
              aria-describedby={hintId}
              onChange={(event) => setParent(event.target.value || null)}
            >
              <option value="">Top level</option>
              {parents.map((item) => (
                <option key={item.id} value={item.id}>
                  {INDENT.repeat(item.depth - 1)}
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {/* Beside the label, not in it, so that the select is called "Inside" and this is read after it. */}
          <small className="muted" id={hintId}>
            Notebooks nest {MAX_NOTEBOOK_DEPTH} levels deep. What is inside a notebook moves with it.
          </small>
        </div>
        {save.error && <ErrorMessage error={save.error} />}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={save.isPending || !name.trim()}>
            {notebook ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
