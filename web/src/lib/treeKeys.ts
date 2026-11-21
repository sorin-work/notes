import type { KeyboardEvent } from 'react';

/**
 * What a notebook in a tree carries, on its link or button, for
 * `treeKeyDown`: its id, and whether what is inside it is shown (`true`),
 * folded (`false`), or there is nothing inside (left out).
 */
export function treeItem(id: string, expanded?: boolean) {
  return { 'data-tree-item': id, 'data-expanded': expanded === undefined ? undefined : String(expanded) };
}

/**
 * The keys of the ARIA tree pattern for a nested list of notebooks, put on
 * the outer list: Up and Down go to the notebook above and below that is
 * shown, Home and End to the first and the last. Right unfolds a folded
 * notebook, or goes to the first one inside an open one. Left folds an open
 * notebook, or goes to the one it is in.
 *
 * The lists keep their links and buttons and get no role="tree": a tree
 * makes a screen reader read everything inside it as tree items, and a
 * notebook here is a link to its notes with buttons beside it. Only the keys
 * are added. Without `toggle` nothing folds, and Left and Right only move.
 */
export function treeKeyDown(toggle?: (id: string) => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    const id = target.dataset.treeItem;
    if (!id) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-tree-item]')];
    const at = items.indexOf(target);
    const expanded = target.dataset.expanded;
    const row = target.closest('li');
    let next: HTMLElement | null | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = items[at + 1];
        break;
      case 'ArrowUp':
        next = items[at - 1];
        break;
      case 'Home':
        next = items[0];
        break;
      case 'End':
        next = items[items.length - 1];
        break;
      case 'ArrowRight':
        if (expanded === 'false' && toggle) {
          event.preventDefault();
          toggle(id);
          return;
        }
        if (expanded === 'true') next = row?.querySelector<HTMLElement>(':scope ul [data-tree-item]');
        break;
      case 'ArrowLeft':
        if (expanded === 'true' && toggle) {
          event.preventDefault();
          toggle(id);
          return;
        }
        {
          const parent = row?.parentElement?.closest('li');
          if (parent && event.currentTarget.contains(parent)) {
            next = parent.querySelector<HTMLElement>('[data-tree-item]');
          }
        }
        break;
      default:
        return;
    }
    // The keys would otherwise scroll the sidebar, also when there is nowhere to go.
    event.preventDefault();
    next?.focus();
  };
}
