import { Modal } from './Modal';
import { ErrorMessage } from './States';

interface Props {
  /** While the note is fetched for "Take theirs". */
  busy?: boolean;
  error?: unknown;
  onKeepBoth(): void;
  onKeepMine(): void;
  onTakeTheirs(): void;
  /** Closing decides nothing: the text stays in the editor, unsaved. */
  onClose(): void;
}

/** Asked when a save was refused because the note changed in another tab or on another device. */
export function ConflictDialog({ busy = false, error, onKeepBoth, onKeepMine, onTakeTheirs, onClose }: Props) {
  return (
    <Modal title="This note was changed somewhere else" onClose={onClose}>
      <div className="confirm-message">
        <p>
          It was saved from another tab or device while you were editing here. Your text is still in the editor, but it
          is not saved.
        </p>
      </div>
      <ul className="conflict-choices">
        <li>
          <button type="button" className="button button-primary" disabled={busy} onClick={onKeepBoth}>
            Keep mine, put theirs in the history
          </button>
          <span className="muted">
            Your text becomes the note. The other text is kept as a version, to compare or restore from History.
          </span>
        </li>
        <li>
          <button type="button" className="button" disabled={busy} onClick={onKeepMine}>
            Keep mine
          </button>
          <span className="muted">Your text becomes the note. The other text is dropped.</span>
        </li>
        <li>
          <button type="button" className="button" disabled={busy} onClick={onTakeTheirs}>
            {busy ? 'Fetching…' : 'Take theirs'}
          </button>
          <span className="muted">The other text, as it is now, becomes the note. What you typed here is dropped.</span>
        </li>
      </ul>
      {error != null && <ErrorMessage error={error} />}
      <p className="muted">Closing this decides nothing. Your text stays here, unsaved, until you choose.</p>
    </Modal>
  );
}
