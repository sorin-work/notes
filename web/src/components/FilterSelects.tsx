import type { Notebook, Tag } from '../api/types';
import { NO_NOTEBOOK } from '../lib/filters';
import { NotebookOptions } from './NotebookSelect';

interface Props {
  notebooks: Notebook[];
  tags: Tag[];
  /** A notebook id, NO_NOTEBOOK, or null for every notebook. */
  notebook: string | null;
  tag: string | null;
  onChange(next: { notebook: string | null; tag: string | null }): void;
}

/** The notebook and tag selects that narrow the note list and the search results. */
export function FilterSelects({ notebooks, tags, notebook, tag, onChange }: Props) {
  // A value from the URL that is not in the lists (yet) still has to show as chosen.
  const strayNotebook = notebook && notebook !== NO_NOTEBOOK && !notebooks.some((item) => item.id === notebook);
  const strayTag = tag && !tags.some((item) => item.name === tag);

  return (
    <div className="filter-selects">
      <select
        aria-label="Filter by notebook"
        value={notebook ?? ''}
        onChange={(event) => onChange({ notebook: event.target.value || null, tag })}
      >
        <option value="">All notebooks</option>
        <NotebookOptions notebooks={notebooks} />
        <option value={NO_NOTEBOOK}>Not in a notebook</option>
        {strayNotebook && <option value={notebook}>Notebook</option>}
      </select>
      <select
        aria-label="Filter by tag"
        value={tag ?? ''}
        onChange={(event) => onChange({ notebook, tag: event.target.value || null })}
      >
        <option value="">All tags</option>
        {tags.map((item) => (
          <option key={item.id} value={item.name}>
            #{item.name}
          </option>
        ))}
        {strayTag && <option value={tag}>#{tag}</option>}
      </select>
    </div>
  );
}
