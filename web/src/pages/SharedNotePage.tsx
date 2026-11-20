import { useMutation, useQuery } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../api/client';
import { getSharedNote, unlockSharedNote } from '../api/shares';
import type { SharedNote } from '../api/types';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { ErrorMessage, FullPageSpinner } from '../components/States';
import { formatDateTime } from '../lib/dates';

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : null);

/** The public, read-only page behind a share link. */
export function SharedNotePage() {
  const { token = '' } = useParams();
  // Never retried: asking again does not make a missing link appear, and for a
  // link with a password every request counts against a small allowance.
  const first = useQuery({ queryKey: ['shared', token], queryFn: () => getSharedNote(token), retry: false });
  const [password, setPassword] = useState('');
  // The note behind a password lives in this component only. Reloading the page asks again.
  const unlock = useMutation({ mutationFn: () => unlockSharedNote(token, password) });

  const note: SharedNote | undefined = first.data ?? unlock.data;
  // 403 is how the API says "there is a note here, behind a password".
  const locked = !note && statusOf(first.error) === 403;
  // The link can run out or be revoked between the prompt and the answer.
  const gone = statusOf(first.error) === 404 || statusOf(unlock.error) === 404;

  useEffect(() => {
    if (note) document.title = `${note.title} · Notes`;
  }, [note]);

  if (first.isLoading) return <FullPageSpinner />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    unlock.mutate();
  };

  return (
    <main className="shared-page">
      {gone ? (
        <div className="shared-missing">
          <h1>This note is not shared</h1>
          <p className="muted">The link may be mistyped, may have run out, or its owner stopped sharing it.</p>
        </div>
      ) : locked ? (
        <form className="shared-missing form shared-locked" onSubmit={submit}>
          <h1>This note needs a password</h1>
          <p className="muted">Whoever sent you the link has the password.</p>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoFocus
            />
          </label>
          {unlock.error && <UnlockError error={unlock.error} />}
          <div className="form-actions start">
            <button type="submit" className="button button-primary" disabled={unlock.isPending}>
              {unlock.isPending ? 'Checking…' : 'Show the note'}
            </button>
          </div>
        </form>
      ) : (
        // Not once the note is open: after the right password the first answer is still the 403 that asked for it.
        !note && first.error && <ErrorMessage error={first.error} />
      )}
      {note && (
        <article className="shared-note">
          <header>
            <h1>{note.title}</h1>
            <p className="muted">
              Last updated {formatDateTime(note.updatedAt)}
              {note.tags.length > 0 && ' · '}
              {note.tags.map((tag) => `#${tag}`).join(' ')}
            </p>
          </header>
          <MarkdownPreview content={note.content} />
        </article>
      )}
      <footer className="shared-footer muted">Shared read-only from Notes</footer>
    </main>
  );
}

function UnlockError({ error }: { error: unknown }) {
  const status = statusOf(error);
  if (status === 403) {
    return (
      <p className="field-error" role="alert">
        That password is not right.
      </p>
    );
  }
  if (status === 429) {
    return (
      <p className="field-error" role="alert">
        Too many attempts on this link. Wait a minute and try again.
      </p>
    );
  }
  return <ErrorMessage error={error} />;
}
