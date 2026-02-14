import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { ApiError } from '../api/client';
import { getSharedNote } from '../api/shares';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { ErrorMessage, FullPageSpinner } from '../components/States';
import { formatDateTime } from '../lib/dates';

/** The public, read-only page behind a share link. */
export function SharedNotePage() {
  const { token = '' } = useParams();
  const note = useQuery({ queryKey: ['shared', token], queryFn: () => getSharedNote(token) });

  if (note.isLoading) return <FullPageSpinner />;

  return (
    <div className="shared-page">
      {note.error &&
        (note.error instanceof ApiError && note.error.status === 404 ? (
          <div className="shared-missing">
            <h1>This note is not shared</h1>
            <p className="muted">The link may be mistyped, or its owner stopped sharing it.</p>
          </div>
        ) : (
          <ErrorMessage error={note.error} />
        ))}
      {note.data && (
        <article className="shared-note">
          <header>
            <h1>{note.data.title}</h1>
            <p className="muted">
              Last updated {formatDateTime(note.data.updatedAt)}
              {note.data.tags.length > 0 && ' · '}
              {note.data.tags.map((tag) => `#${tag}`).join(' ')}
            </p>
          </header>
          <MarkdownPreview content={note.data.content} />
        </article>
      )}
      <footer className="shared-footer muted">Shared read-only from Notes</footer>
    </div>
  );
}
