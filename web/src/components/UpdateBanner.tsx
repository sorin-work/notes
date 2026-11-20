import { useState } from 'react';
import { applyUpdate, useUpdateWaiting } from '../lib/appUpdate';

/** Offers the new version of the app once it is downloaded. Reloading is up to the user. */
export function UpdateBanner() {
  const waiting = useUpdateWaiting();
  const [busy, setBusy] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  if (!waiting) return null;

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
