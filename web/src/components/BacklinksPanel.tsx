import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { backlinks } from '../api/notes';
import { formatRelative } from '../lib/dates';

export function BacklinksPanel({ noteId }: { noteId: string }) {
  const location = useLocation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['backlinks', noteId],
    queryFn: () => backlinks(noteId),
  });

  return (
    <section className="backlinks" aria-labelledby="backlinks-heading">
      <h3 id="backlinks-heading">Backlinks{data && data.length > 0 && <span className="count">{data.length}</span>}</h3>
      {isLoading && <p className="muted">Loading…</p>}
      {isError && <p className="muted">Backlinks could not be loaded.</p>}
      {data && data.length === 0 && (
        <p className="muted">
          No notes link here yet. Link to this note from another one with <code>[[its title]]</code>.
        </p>
      )}
      {data && data.length > 0 && (
        <ul>
          {data.map((link) => (
            <li key={link.id}>
              <Link to={{ pathname: `/notes/${link.id}`, search: location.search }} className="backlink-title">
                {link.title}
              </Link>
              <span className="muted"> · {formatRelative(link.updatedAt)}</span>
              {link.context && <p className="backlink-context">{link.context}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
