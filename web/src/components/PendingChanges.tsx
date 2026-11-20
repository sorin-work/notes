import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOnline } from '../hooks/useOnline';
import { discardEntry, type OutboxEntry, replay, saveAsNewNote, useOutbox } from '../lib/outbox';
import { savedTitle } from '../lib/text';

/**
 * What the outbox holds: changes made without a connection that the server
 * does not have yet. Those it could not apply stay there and are listed here
 * by note, with what can be done about each, until the user decides.
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
            <button type="button" className="link-button" onClick={() => void replay(true)}>
              Send now
            </button>
          )}
        </p>
      )}
      {attention.length > 0 && (
        <ul>
          {attention.map((entry) => (
            <Attention key={entry.seq} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Attention({ entry }: { entry: OutboxEntry }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const title = <Link to={`/notes/${entry.noteId}`}>{savedTitle(entry.title)}</Link>;
  if (entry.state === 'conflict') {
    return <li>{title}: the note was changed elsewhere meanwhile. Open it to decide what to keep.</li>;
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(entry.content);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const keep = async () => {
    const id = await saveAsNewNote(entry.seq!);
    if (id) navigate(`/notes/${id}`);
  };
  return (
    <li>
      {entry.reason === 'gone' ? savedTitle(entry.title) : title}: could not be sent. {entry.problem}{' '}
      {entry.reason !== 'refused' && (
        <button type="button" className="link-button" onClick={() => void keep()}>
          Save as a new note
        </button>
      )}{' '}
      <button type="button" className="link-button" onClick={() => void copy()}>
        {copied ? 'Text copied' : 'Copy text'}
      </button>{' '}
      <button type="button" className="link-button" onClick={() => void discardEntry(entry.seq!)}>
        Discard this change
      </button>
    </li>
  );
}
