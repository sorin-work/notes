import { type KeyboardEvent, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { NoteSummary } from '../api/types';
import { formatRelative } from '../lib/dates';
import { PinIcon } from './Icons';

/** While notes are being selected: which are, and what a click on a box or Space does. */
export interface Selection {
  selected: ReadonlySet<string>;
  /**
   * Flips one note, or with `range` selects every note from where the range
   * started to this one. `from` is the note the focus moved from, where a
   * range that has not started yet starts.
   */
  onToggle(id: string, range: boolean, from?: string): void;
}

interface Props {
  notes: NoteSummary[];
  activeId?: string;
  selection?: Selection;
}

/**
 * Up and Down move the focus from note to note, Home and End go to the
 * first and the last. While selecting, Space selects the note with the
 * focus, and Shift with Up or Down moves and selects as it goes.
 */
function onListKey(event: KeyboardEvent<HTMLUListElement>, selection: Selection | undefined) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const links = [...event.currentTarget.querySelectorAll<HTMLElement>('a')];
  const current = links.indexOf(document.activeElement as HTMLElement);
  if (current === -1) return;
  const idAt = (index: number) => links[index]?.dataset.noteId;
  if (selection && event.key === ' ' && !event.shiftKey) {
    event.preventDefault();
    const id = idAt(current);
    if (id) selection.onToggle(id, false);
    return;
  }
  if (event.shiftKey && !(selection && (event.key === 'ArrowDown' || event.key === 'ArrowUp'))) return;
  const target = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: links.length - 1 }[event.key];
  if (target === undefined || !links[target]) return;
  // The keys would otherwise scroll the list away from the focus.
  event.preventDefault();
  links[target]?.focus();
  const id = idAt(target);
  if (selection && event.shiftKey && id) selection.onToggle(id, true, idAt(current));
}

/**
 * The list is one Tab stop: Tab goes to the note that had the focus last,
 * else the open note, else the first one, and the next Tab leaves the list.
 * The arrow keys, Home and End move inside it. The note with the focus is
 * remembered by its id, so it keeps its place when the list reloads, for as
 * long as it is in the list and the same note is open. Opening another note,
 * from here or elsewhere, makes that one the place to come back to.
 */
export function NoteList({ notes, activeId, selection }: Props) {
  const location = useLocation();
  const [focused, setFocused] = useState<{ id: string; whileOpen?: string } | null>(null);
  const has = (id: string | null | undefined) => !!id && notes.some((note) => note.id === id);
  const focusedId = focused && focused.whileOpen === activeId ? focused.id : null;
  const tabStop = has(focusedId) ? focusedId : has(activeId) ? activeId : notes[0]?.id;
  return (
    <ul
      className={selection ? 'note-list selecting' : 'note-list'}
      onKeyDown={(event) => onListKey(event, selection)}
      aria-multiselectable={selection ? true : undefined}
    >
      {notes.map((note) => (
        <li key={note.id} className={selection?.selected.has(note.id) ? 'selected' : undefined}>
          {selection && (
            <input
              type="checkbox"
              className="note-select"
              tabIndex={-1}
              aria-label={`Select “${note.title}”`}
              checked={selection.selected.has(note.id)}
              // React reports a box's change as the click it came from, so Shift can be read off it: a range.
              onChange={(event) => selection.onToggle(note.id, (event.nativeEvent as MouseEvent).shiftKey === true)}
            />
          )}
          <Link
            to={{ pathname: `/notes/${note.id}`, search: location.search }}
            data-note-id={note.id}
            aria-description={selection ? (selection.selected.has(note.id) ? 'Selected' : 'Not selected') : undefined}
            tabIndex={note.id === tabStop ? 0 : -1}
            onFocus={() => setFocused({ id: note.id, whileOpen: activeId })}
            className={note.id === activeId ? 'note-item active' : 'note-item'}
            aria-current={note.id === activeId ? 'page' : undefined}
          >
            <div className="note-item-header">
              <span className="note-item-title">{note.title}</span>
              {note.pinned && (
                <span className="flag" title="Pinned" aria-label="Pinned">
                  <PinIcon size={13} filled />
                </span>
              )}
              {note.favorite && (
                <span className="flag favourite" title="Favourite" aria-label="Favourite">
                  ★
                </span>
              )}
            </div>
            {note.excerpt && <p className="note-item-excerpt">{note.excerpt}</p>}
            <div className="note-item-meta">
              <time dateTime={note.updatedAt}>{formatRelative(note.updatedAt)}</time>
              {note.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="tag-pill">
                  #{tag}
                </span>
              ))}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
