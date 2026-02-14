import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createShare, getShare, revokeShare, shareUrl } from '../api/shares';
import { formatRelative } from '../lib/dates';
import { Modal } from './Modal';
import { ErrorMessage, Spinner } from './States';

export function ShareDialog({ noteId, onClose }: { noteId: string; onClose(): void }) {
  const queryClient = useQueryClient();
  const share = useQuery({ queryKey: ['share', noteId], queryFn: () => getShare(noteId) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['share', noteId] });
    void queryClient.invalidateQueries({ queryKey: ['note', noteId] });
  };
  const create = useMutation({ mutationFn: () => createShare(noteId), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: () => revokeShare(noteId), onSuccess: refresh });

  const link = share.data?.share;
  const url = link ? shareUrl(link.token) : '';

  return (
    <Modal title="Share note" onClose={onClose}>
      {share.isLoading && <Spinner />}
      {share.error && <ErrorMessage error={share.error} />}
      {share.data && !link && (
        <>
          <p>Anyone with the link can read this note. They cannot edit it or see your other notes.</p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              Create link
            </button>
          </div>
        </>
      )}
      {link && (
        <>
          <label className="field">
            <span>Read-only link</span>
            <input readOnly value={url} onFocus={(event) => event.target.select()} aria-label="Share link" />
          </label>
          <p className="muted">
            Shared {formatRelative(link.createdAt)} · viewed {link.viewCount} {link.viewCount === 1 ? 'time' : 'times'}.
            Changes you make show up for readers straight away.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-danger"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending}
            >
              Stop sharing
            </button>
          </div>
        </>
      )}
      {(create.error || revoke.error) && <ErrorMessage error={create.error ?? revoke.error} />}
    </Modal>
  );
}
