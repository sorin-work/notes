import { type KeyboardEvent, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { NoteSummary } from '../api/types';
import { formatRelative } from '../lib/dates';
import { PinIcon } from './Icons';

interface Props {
  notes: NoteSummary[];
  activeId?: string;
}

/** Up and Down move the focus from note to note, Home and End go to the first and the last. */
function moveFocus(event: KeyboardEvent<HTMLUListElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const links = [...event.currentTarget.querySelectorAll<HTMLElement>('a')];
  const current = links.indexOf(document.activeElement as HTMLElement);
  const target = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: links.length - 1 }[event.key];
  if (current === -1 || target === undefined) return;
  // The keys would otherwise scroll the list away from the focus.
  event.preventDefault();
  links[target]?.focus();
}

/**
 * The list is one Tab stop: Tab goes to the note that had the focus last,
 * else the open note, else the first one, and the next Tab leaves the list.
 * The arrow keys, Home and End move inside it. The note with the focus is
 * remembered by its id, so it keeps its place when the list reloads, for as
 * long as it is in the list and the same note is open. Opening another note,
 * from here or elsewhere, makes that one the place to come back to.
 */
export function NoteList({ notes, activeId }: Props) {
  const location = useLocation();
  const [focused, setFocused] = useState<{ id: string; whileOpen?: string } | null>(null);
  const has = (id: string | null | undefined) => !!id && notes.some((note) => note.id === id);
  const focusedId = focused && focused.whileOpen === activeId ? focused.id : null;
  const tabStop = has(focusedId) ? focusedId : has(activeId) ? activeId : notes[0]?.id;
  return (
    <ul className="note-list" onKeyDown={moveFocus}>
      {notes.map((note) => (
        <li key={note.id}>
          <Link
            to={{ pathname: `/notes/${note.id}`, search: location.search }}
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
