import type { Note } from '../api/types';
import { formatRelative } from '../lib/dates';
import { Modal } from './Modal';

interface Props {
  /** The note as it was saved from somewhere else. */
  theirs: Note;
  onKeepBoth(): void;
  onKeepMine(): void;
  onTakeTheirs(): void;
  /** Closing decides nothing: the text stays in the editor, unsaved. */
  onClose(): void;
}

/** Asked when a save was refused because the note changed in another tab or on another device. */
export function ConflictDialog({ theirs, onKeepBoth, onKeepMine, onTakeTheirs, onClose }: Props) {
  return (
    <Modal title="This note was changed somewhere else" onClose={onClose}>
      <div className="confirm-message">
        <p>
          Another tab or device saved it {formatRelative(theirs.updatedAt)}, while you were editing here. Your text is
          still in the editor, but it is not saved.
        </p>
      </div>
      <ul className="conflict-choices">
        <li>
          <button type="button" className="button button-primary" onClick={onKeepBoth}>
            Keep mine, put theirs in the history
          </button>
          <span className="muted">
            Your text becomes the note. The other text is kept as a version, to compare or restore from History.
          </span>
        </li>
        <li>
          <button type="button" className="button" onClick={onKeepMine}>
            Keep mine
          </button>
          <span className="muted">Your text becomes the note. The other text is dropped.</span>
        </li>
        <li>
          <button type="button" className="button" onClick={onTakeTheirs}>
            Take theirs
          </button>
          <span className="muted">The other text becomes the note. What you typed here is dropped.</span>
        </li>
      </ul>
      <p className="muted">Closing this decides nothing. Your text stays here, unsaved, until you choose.</p>
    </Modal>
  );
}
