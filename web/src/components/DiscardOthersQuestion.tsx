import { useCallback, useState } from 'react';
import type { ConfirmDiscard } from '../auth/AuthContext';
import { ConfirmDialog } from './Modal';

/**
 * The question asked before signing in deletes changes that another account
 * made offline on this browser and never sent. Returns the function to pass
 * to `login` or `register`, and the dialog to render.
 */
export function useDiscardOthersQuestion(): [ConfirmDiscard, React.ReactNode] {
  const [asking, setAsking] = useState<{ count: number; answer: (yes: boolean) => void } | null>(null);
  const confirm = useCallback<ConfirmDiscard>(
    (count) => new Promise((resolve) => setAsking({ count, answer: resolve })),
    [],
  );
  const answer = (yes: boolean) => {
    asking?.answer(yes);
    setAsking(null);
  };
  const dialog = asking && (
    <ConfirmDialog
      title="Delete another account’s unsent changes?"
      message={
        <p>
          This browser holds {asking.count === 1 ? '1 change' : `${asking.count} changes`} that another account made
          without a connection and has not sent yet. Signing in as someone else deletes them. To keep them, cancel and
          let that person sign in here first.
        </p>
      }
      confirmLabel="Sign in and delete them"
      danger
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  );
  return [confirm, dialog];
}
