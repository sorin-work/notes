import type { Notebook } from '../api/types';
import { notebookTree } from '../lib/notebooks';

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
      {notebookTree(notebooks).map((parent) => [
        <option key={parent.id} value={parent.id}>
          {parent.name}
        </option>,
        ...parent.children.map((child) => (
          <option key={child.id} value={child.id}>
            {'   '}
            {child.name}
          </option>
        )),
      ])}
    </select>
  );
}
