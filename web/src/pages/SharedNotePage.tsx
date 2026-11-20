import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { getShared, getSharedNoteIn, unlockShared } from '../api/shares';
import type { SharedNote, SharedNotebook } from '../api/types';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { ErrorMessage, FullPageSpinner } from '../components/States';
import { formatDateTime, formatRelative } from '../lib/dates';
import { normalizeTitle } from '../lib/wikilinks';

const statusOf = (error: unknown) => (error instanceof ApiError ? error.status : null);

/**
 * The public, read-only page behind a share link: `/s/<token>` for a shared
 * note or the index of a shared notebook, `/s/<token>/<note>` for a note of
 * that notebook.
 */
export function SharedNotePage() {
  const { token = '', noteId } = useParams();
  const queryClient = useQueryClient();
  const queryKey = ['shared', token, noteId ?? null];
  // Never retried: asking again does not make a missing link appear, and for a
  // link with a password every request counts against a small allowance.
  const shared = useQuery({
    queryKey,
    queryFn: () => (noteId ? getSharedNoteIn(token, noteId) : getShared(token)),
    retry: false,
  });
  const [password, setPassword] = useState('');
  const unlock = useMutation({
    mutationFn: () => unlockShared(token, password),
    onSuccess: (root) => {
      setPassword('');
      // The password opens the link as a whole. The answer is what `/s/<token>` shows. A note
      // inside a notebook is asked for again, now that the proof of the password goes along.
      queryClient.setQueryData(['shared', token, null], root);
      if (noteId) void queryClient.invalidateQueries({ queryKey });
    },
  });

  const content = shared.data;
  // 403 is how the API says "there is something here, behind a password".
  const locked = !content && statusOf(shared.error) === 403;
  // The link can run out or be revoked between the prompt and the answer.
  const gone = statusOf(shared.error) === 404 || statusOf(unlock.error) === 404;

  useEffect(() => {
    if (content) document.title = `${content.kind === 'note' ? content.title : content.name} · Notes`;
  }, [content]);

  if (shared.isLoading) return <FullPageSpinner />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    unlock.mutate();
  };

  return (
    <main className="shared-page">
      {gone ? (
        <div className="shared-missing">
          <h1>This is not shared</h1>
          <p className="muted">The link may be mistyped, may have run out, or its owner stopped sharing it.</p>
          {noteId && (
            <p>
              <Link to={`/s/${token}`}>See what else is shared here</Link>
            </p>
          )}
        </div>
      ) : locked ? (
        <form className="shared-missing form shared-locked" onSubmit={submit}>
          <h1>This link needs a password</h1>
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
              {unlock.isPending ? 'Checking…' : 'Show it'}
            </button>
          </div>
        </form>
      ) : (
        shared.error && <ErrorMessage error={shared.error} />
      )}
      {content?.kind === 'note' && <SharedNoteView note={content} indexPath={noteId ? `/s/${token}` : null} />}
      {content?.kind === 'notebook' && <SharedNotebookView notebook={content} token={token} />}
      <footer className="shared-footer muted">Shared read-only from Notes</footer>
    </main>
  );
}

function SharedNoteView({ note, indexPath }: { note: SharedNote; indexPath: string | null }) {
  const navigate = useNavigate();
  // The API leaves [[links]] in the text only where they lead somewhere this
  // reader may go, and says where. Anything else stays plain text here too.
  const linked = useMemo(() => new Set(Object.keys(note.links)), [note.links]);
  const follow = (title: string) => {
    const path = note.links[normalizeTitle(title)];
    if (path) navigate(path);
  };
  return (
    <article className="shared-note">
      <header>
        {indexPath && (
          <p>
            <Link to={indexPath}>All notes shared here</Link>
          </p>
        )}
        <h1>{note.title}</h1>
        <p className="muted">
          Last updated {formatDateTime(note.updatedAt)}
          {note.tags.length > 0 && ' · '}
          {note.tags.map((tag) => `#${tag}`).join(' ')}
        </p>
      </header>
      <MarkdownPreview content={note.content} onWikiLink={follow} linkedTitles={linked} />
    </article>
  );
}

function SharedNotebookView({ notebook, token }: { notebook: SharedNotebook; token: string }) {
  // Notes of the notebook itself come first, then one group for each notebook inside it.
  const groups: { name: string | null; notes: SharedNotebook['notes'] }[] = [];
  for (const note of notebook.notes) {
    const last = groups[groups.length - 1];
    if (last && last.name === note.notebook) last.notes.push(note);
    else groups.push({ name: note.notebook, notes: [note] });
  }
  return (
    <article className="shared-note">
      <header>
        <h1>{notebook.name}</h1>
        <p className="muted">
          {notebook.notes.length} {notebook.notes.length === 1 ? 'note' : 'notes'}
        </p>
      </header>
      {notebook.notes.length === 0 && <p className="muted">There are no notes in this notebook yet.</p>}
      {groups.map((group) => (
        <section key={group.name ?? ''} aria-label={group.name ?? notebook.name}>
          {group.name && <h2>{group.name}</h2>}
          <ul className="shared-index">
            {group.notes.map((note) => (
              <li key={note.id}>
                <Link to={`/s/${token}/${note.id}`}>{note.title || 'Untitled'}</Link>{' '}
                <span className="muted">· {formatRelative(note.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
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
