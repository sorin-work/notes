import type { Notebook } from '../api/types';

/** How deep notebooks nest. The API has the same number and enforces it. A notebook at the top is level 1. */
export const MAX_NOTEBOOK_DEPTH = 4;

export interface NotebookNode extends Notebook {
  children: NotebookNode[];
  /** The level the notebook sits at: 1 at the top. */
  depth: number;
}

const byName = (a: Notebook, b: Notebook) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

/**
 * The notebooks as a tree, with the notebooks at each place sorted by name.
 * A notebook whose parent is not in the list is shown at the top, so that it
 * never goes missing.
 */
export function notebookTree(notebooks: Notebook[]): NotebookNode[] {
  const ids = new Set(notebooks.map((notebook) => notebook.id));
  const below = (parentId: string | null, depth: number, above: Set<string>): NotebookNode[] =>
    notebooks
      .filter((notebook) =>
        parentId === null ? notebook.parentId === null || !ids.has(notebook.parentId) : notebook.parentId === parentId,
      )
      // A loop in the data would otherwise never end.
      .filter((notebook) => !above.has(notebook.id))
      .sort(byName)
      .map((notebook) => ({
        ...notebook,
        depth,
        children: below(notebook.id, depth + 1, new Set(above).add(notebook.id)),
      }));
  return below(null, 1, new Set());
}

/** Every notebook of a tree in the order it is listed: each one followed by what is inside it. */
export function flattenTree(tree: NotebookNode[]): NotebookNode[] {
  return tree.flatMap((node) => [node, ...flattenTree(node.children)]);
}

/** Notes in a notebook plus those in every notebook inside it. */
export function totalNotes(node: NotebookNode): number {
  return node.noteCount + node.children.reduce((sum, child) => sum + totalNotes(child), 0);
}

/** How many levels a notebook takes up together with what is inside it: 1 for one with nothing inside. */
export function heightOf(node: NotebookNode): number {
  return 1 + Math.max(0, ...node.children.map(heightOf));
}

/** The names that lead to a notebook, as in "Work / Meetings / Weekly". */
export function notebookLabel(notebooks: Notebook[], id: string): string | null {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let at = notebooks.find((item) => item.id === id); at && !seen.has(at.id);) {
    names.unshift(at.name);
    seen.add(at.id);
    const parentId: string | null = at.parentId;
    at = parentId ? notebooks.find((item) => item.id === parentId) : undefined;
  }
  return names.length > 0 ? names.join(' / ') : null;
}

/** Whether notebook `id` is `ancestor` itself or sits somewhere inside it. */
export function isInside(notebooks: Notebook[], id: string | null, ancestor: string): boolean {
  const seen = new Set<string>();
  for (let at = id; at && !seen.has(at);) {
    if (at === ancestor) return true;
    seen.add(at);
    at = notebooks.find((item) => item.id === at)?.parentId ?? null;
  }
  return false;
}

/**
 * The notebooks that `moving` can be put into, in the order of the tree: not
 * itself, nothing inside it, and nothing so deep that the notebook, with what
 * is inside it, would end up below the last level. Pass null for a notebook
 * that does not exist yet.
 */
export function possibleParents(notebooks: Notebook[], moving: Notebook | null): NotebookNode[] {
  const all = flattenTree(notebookTree(notebooks));
  const height = moving
    ? heightOf(all.find((node) => node.id === moving.id) ?? { ...moving, depth: 1, children: [] })
    : 1;
  return all.filter(
    (node) => node.depth + height <= MAX_NOTEBOOK_DEPTH && !(moving && isInside(notebooks, node.id, moving.id)),
  );
}
