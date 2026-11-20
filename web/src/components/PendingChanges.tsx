import { Link } from 'react-router';
import { useOnline } from '../hooks/useOnline';
import { discardEntry, replay, useOutbox } from '../lib/outbox';
import { savedTitle } from '../lib/text';

/**
 * What the outbox holds: changes made without a connection that the server
 * does not have yet. Those it could not apply stay there and are listed here
 * by note, until the user decides.
 */
export function PendingChanges() {
  const entries = useOutbox();
  const online = useOnline();
  if (entries.length === 0) return null;
  const waiting = entries.filter((entry) => entry.state === 'waiting').length;
  const attention = entries.filter((entry) => entry.state !== 'waiting');

  return (
    <section className="pending-changes" aria-label="Changes not sent yet">
      {waiting > 0 && (
        <p>
          {waiting === 1 ? '1 change' : `${waiting} changes`} made without a connection{' '}
          {online ? 'will be sent now.' : 'will be sent when the server can be reached.'}{' '}
          {online && (
            <button type="button" className="link-button" onClick={() => void replay()}>
              Send now
            </button>
          )}
        </p>
      )}
      {attention.length > 0 && (
        <ul>
          {attention.map((entry) => (
            <li key={entry.noteId}>
              <Link to={`/notes/${entry.noteId}`}>{savedTitle(entry.title)}</Link>:{' '}
              {entry.state === 'conflict'
                ? 'the note was changed elsewhere meanwhile. Open it to decide what to keep.'
                : `could not be sent. ${entry.problem ?? ''}`}
              {entry.state === 'stuck' && (
                <>
                  {' '}
                  <button type="button" className="link-button" onClick={() => void discardEntry(entry.noteId)}>
                    Discard this change
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
