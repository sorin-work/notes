import type { Notebook } from '../api/types';

export interface NotebookNode extends Notebook {
  children: Notebook[];
}

/** Top-level notebooks, each with its nested notebooks, sorted by name. */
export function notebookTree(notebooks: Notebook[]): NotebookNode[] {
  const byName = (a: Notebook, b: Notebook) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return notebooks
    .filter((notebook) => notebook.parentId === null)
    .sort(byName)
    .map((parent) => ({
      ...parent,
      children: notebooks.filter((notebook) => notebook.parentId === parent.id).sort(byName),
    }));
}

/** Notes in a notebook plus those in the notebooks inside it. */
export function totalNotes(node: NotebookNode): number {
  return node.noteCount + node.children.reduce((sum, child) => sum + child.noteCount, 0);
}

export function notebookLabel(notebooks: Notebook[], id: string): string | null {
  const notebook = notebooks.find((item) => item.id === id);
  if (!notebook) return null;
  const parent = notebook.parentId ? notebooks.find((item) => item.id === notebook.parentId) : null;
  return parent ? `${parent.name} / ${notebook.name}` : notebook.name;
}
