import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { createNotebook, updateNotebook } from '../api/notebooks';
import type { Notebook } from '../api/types';
import { Modal } from './Modal';
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

export function NotebookDialog({ notebook, parentId = null, onClose, onSaved }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(notebook?.name ?? '');
  const parent = notebook ? notebook.parentId : parentId;

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
