import { Link } from 'react-router';
import type { NoteSummary } from '../api/types';
import { formatRelative } from '../lib/dates';

interface Props {
  notes: NoteSummary[];
  activeId?: string;
}

export function NoteList({ notes, activeId }: Props) {
  return (
    <ul className="note-list">
      {notes.map((note) => (
        <li key={note.id}>
          <Link
            to={`/notes/${note.id}`}
            className={note.id === activeId ? 'note-item active' : 'note-item'}
            aria-current={note.id === activeId ? 'page' : undefined}
          >
            <div className="note-item-header">
              <span className="note-item-title">{note.title}</span>
              {note.pinned && (
                <span className="flag" title="Pinned" aria-label="Pinned">
                  📌
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
