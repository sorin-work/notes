import { useState } from 'react';
import { applyUpdate, useUpdateState } from '../lib/appUpdate';
import { Modal } from './Modal';

/** Offers the new version of the app, and insists when another tab has already switched to it. */
export function UpdateBanner() {
  const state = useUpdateState();
  const [busy, setBusy] = useState(false);
  const [unsaved, setUnsaved] = useState(false);

  if (state === 'must-reload') {
    return (
      <Modal title="Reload to continue" onClose={() => window.location.reload()}>
        <div className="confirm-message">
          <p>
            A new version of Notes was started in another tab, and this tab cannot go on with the old one. Your latest
            changes could not be saved, so they are kept in this tab and offered when you open the note again.
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="button button-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </Modal>
    );
  }
  if (state === 'none') return null;

  const reload = async () => {
    setBusy(true);
    const started = await applyUpdate();
    setBusy(false);
    setUnsaved(!started);
  };

  return (
    <div className="update-banner" role="status">
      <span>
        {unsaved
          ? 'Your latest changes are not saved yet, so the app was not reloaded. Try again once they are.'
          : 'A new version of Notes is available.'}
      </span>
      <button type="button" className="button button-primary" disabled={busy} onClick={() => void reload()}>
        Reload
      </button>
    </div>
  );
}
