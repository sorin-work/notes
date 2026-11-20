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

/** Your own notebooks, without those other accounts share with you. */
export function ownNotebooks(notebooks: Notebook[]): Notebook[] {
  return notebooks.filter((notebook) => (notebook.access ?? 'owner') === 'owner');
}

/** Notes in a notebook plus those in the notebooks inside it. */
export function totalNotes(node: NotebookNode): number {
  return node.noteCount + node.children.reduce((sum, child) => sum + child.noteCount, 0);
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What deleting a notebook moves to the trash, counting the notebooks inside it, as a sentence. */
export function trashedWith(notebooks: Notebook[], id: string): string {
  const deleted = notebooks.filter((notebook) => notebook.id === id || notebook.parentId === id);
  const notes = deleted.reduce((sum, notebook) => sum + notebook.noteCount, 0);
  const templates = deleted.reduce((sum, notebook) => sum + notebook.templateCount, 0);
  if (notes === 0 && templates === 0) return 'There are no notes in it.';
  const what = [
    ...(notes > 0 ? [count(notes, 'note', 'notes')] : []),
    ...(templates > 0 ? [count(templates, 'template', 'templates')] : []),
  ].join(' and ');
  const one = notes + templates === 1;
  return `${what} ${one ? 'moves' : 'move'} to the trash, where you can restore ${one ? 'it' : 'them'} for 30 days.`;
}

export function notebookLabel(notebooks: Notebook[], id: string): string | null {
  const notebook = notebooks.find((item) => item.id === id);
  if (!notebook) return null;
  const parent = notebook.parentId ? notebooks.find((item) => item.id === notebook.parentId) : null;
  return parent ? `${parent.name} / ${notebook.name}` : notebook.name;
}
