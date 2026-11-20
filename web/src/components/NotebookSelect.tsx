import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Notebook } from '../api/types';
import { useStoredSet } from '../hooks/useStoredSet';
import { flattenTree, type NotebookNode, notebookLabel, notebookTree } from '../lib/notebooks';
import { TreeToggle } from './TreeToggle';

interface Props {
  notebooks: Notebook[];
  value: string | null;
  onChange(notebookId: string | null): void;
  disabled?: boolean;
  label?: string;
}

/**
 * Picks the notebook of a note. A button shows where the note is, with the
 * whole way to it ("Work / Meetings / Weekly"), and opens the notebooks as
 * a list that folds like the one in the sidebar. Everything in it is a
 * button in a plain nested list, so Tab, Enter and Space are all it takes.
 * Escape closes it. What is folded is remembered, apart from the sidebar:
 * looking for a notebook here should not rearrange the sidebar.
 */
export function NotebookSelect({ notebooks, value, onChange, disabled, label = 'Notebook' }: Props) {
  const [open, setOpen] = useState(false);
  const [closed, toggleClosed] = useStoredSet('notes.closedNotebooks.select');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const tree = useMemo(() => notebookTree(notebooks), [notebooks]);
  const current = value === null ? 'No notebook' : (notebookLabel(notebooks, value) ?? 'Notebook');

  // A click anywhere else closes the list, as it would close a select.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const show = () => {
    // The way to the notebook the note is in is unfolded, so that the choice that stands can be seen.
    const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
    const seen = new Set<string>();
    for (let at = byId.get(value ?? '')?.parentId; at && !seen.has(at); at = byId.get(at)?.parentId) {
      seen.add(at);
      if (closed.has(at)) toggleClosed(at);
    }
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const choose = (notebookId: string | null) => {
    close();
    if (notebookId !== value) onChange(notebookId);
  };

  const option = (notebookId: string | null, name: string) => (
    <button
      type="button"
      className="notebook-option"
      aria-current={notebookId === value ? 'true' : undefined}
      onClick={() => choose(notebookId)}
    >
      {name}
    </button>
  );
  const branch = (node: NotebookNode) => {
    const unfolded = !closed.has(node.id);
    const insideId = `${listId}-in-${node.id}`;
    return (
      <li key={node.id}>
        <div className="nav-row">
          {node.children.length > 0 ? (
            <TreeToggle name={node.name} open={unfolded} controls={insideId} onToggle={() => toggleClosed(node.id)} />
          ) : (
            <span className="tree-toggle" aria-hidden="true" />
          )}
          {option(node.id, node.name)}
        </div>
        {node.children.length > 0 && unfolded && <ul id={insideId}>{node.children.map(branch)}</ul>}
      </li>
    );
  };

  return (
    <div
      className="notebook-select"
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        // Only the list closes, not a dialog this may sit in.
        event.stopPropagation();
        close();
      }}
      onBlur={(event) => {
        // Tabbing out closes the list. A click on its own padding moves the focus nowhere and does not.
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="button notebook-select-button"
        aria-label={`${label}: ${current}`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span className="notebook-select-current">{current}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="notebook-select-list" id={listId} role="group" aria-label={`${label}, pick one`}>
          <ul>
            <li>
              <div className="nav-row">
                <span className="tree-toggle" aria-hidden="true" />
                {option(null, 'No notebook')}
              </div>
            </li>
            {tree.map(branch)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A step of indent in a select, where ordinary spaces at the start of an option are dropped. */
export const INDENT = '    ';

/**
 * One option per notebook for a native select, in the order of the tree,
 * each indented by how deep it sits. Used where a notebook narrows a list
 * down or a notebook gets a place, not where a note gets a notebook.
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
