import type { KeyboardEvent } from 'react';
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

export function NoteList({ notes, activeId }: Props) {
  const location = useLocation();
  return (
    <ul className="note-list" onKeyDown={moveFocus}>
      {notes.map((note) => (
        <li key={note.id}>
          <Link
            to={{ pathname: `/notes/${note.id}`, search: location.search }}
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
