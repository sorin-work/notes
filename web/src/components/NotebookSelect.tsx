import type { Notebook } from '../api/types';
import { flattenTree, notebookTree } from '../lib/notebooks';

interface Props {
  notebooks: Notebook[];
  value: string | null;
  onChange(notebookId: string | null): void;
  disabled?: boolean;
  label?: string;
}

export function NotebookSelect({ notebooks, value, onChange, disabled, label = 'Notebook' }: Props) {
  return (
    <select
      className="notebook-select"
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="">No notebook</option>
      <NotebookOptions notebooks={notebooks} />
    </select>
  );
}

/** A step of indent in a select, where ordinary spaces at the start of an option are dropped. */
export const INDENT = '\u00a0 \u00a0 ';

/**
 * One option per notebook, in the order of the tree, each indented by how
 * deep it sits. A select cannot fold parts of its list away, but it can be
 * searched by typing, which a list that folds could not offer as simply.
 */
export function NotebookOptions({ notebooks }: { notebooks: Notebook[] }) {
  return (
    <>
      {flattenTree(notebookTree(notebooks)).map((notebook) => (
        <option key={notebook.id} value={notebook.id}>
          {INDENT.repeat(notebook.depth - 1)}
          {notebook.name}
        </option>
      ))}
    </>
  );
}
