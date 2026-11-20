import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { createShare, getShare, revokeShare, shareUrl, updateShare } from '../api/shares';
import type { Share, ShareOptions, ShareSubject } from '../api/types';
import { formatDateTime, formatRelative } from '../lib/dates';
import { Modal } from './Modal';
import { ErrorMessage, Spinner } from './States';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long from now, for the choices in the dialog. */
const EXPIRY_CHOICES = [
  { value: '1', label: 'In a day' },
  { value: '7', label: 'In a week' },
  { value: '30', label: 'In 30 days' },
];

/** For a note, or with `notebookId` for a notebook and everything in it. */
export function ShareDialog({
  noteId,
  notebookId,
  onClose,
}: { onClose(): void } & ({ noteId: string; notebookId?: undefined } | { notebookId: string; noteId?: undefined })) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const subject: ShareSubject = notebookId ? { notebookId } : { noteId: noteId ?? '' };
  const id = notebookId ?? noteId;
  const shareKey = ['share', notebookId ? 'notebook' : 'note', id];
  const share = useQuery({ queryKey: shareKey, queryFn: () => getShare(subject) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: shareKey });
    if (noteId) void queryClient.invalidateQueries({ queryKey: ['note', noteId] });
  };
  const create = useMutation({ mutationFn: () => createShare(subject), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: () => revokeShare(subject), onSuccess: refresh });

  const link = share.data?.share;
  const url = link ? shareUrl(link.token) : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal title={notebookId ? 'Share notebook' : 'Share note'} onClose={onClose}>
      {share.isLoading && <Spinner />}
      {share.error && <ErrorMessage error={share.error} />}
      {share.data && !link && (
        <>
          {notebookId ? (
            <p>
              Anyone with the link can read every note in this notebook and in the notebooks inside it, also the ones
              you add later. They cannot edit anything or see notes outside it. A note you move out or delete is gone
              for them at once.
            </p>
          ) : (
            <p>Anyone with the link can read this note. They cannot edit it or see your other notes.</p>
          )}
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
            <div className="input-row">
              <input readOnly value={url} onFocus={(event) => event.target.select()} aria-label="Share link" />
              <button type="button" className="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </label>
          <p className="muted">
            Shared {formatRelative(link.createdAt)} · viewed {link.viewCount} {link.viewCount === 1 ? 'time' : 'times'},
            not counting you. Changes you make show up for readers straight away.
          </p>
          <ShareOptionsForm subject={subject} link={link} onChanged={refresh} />
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

/** When the link runs out and whether it asks for a password. The link itself stays the same. */
function ShareOptionsForm({ subject, link, onChanged }: { subject: ShareSubject; link: Share; onChanged(): void }) {
  const [password, setPassword] = useState('');
  const change = useMutation({
    mutationFn: (options: ShareOptions) => updateShare(subject, options),
    onSuccess: () => {
      setPassword('');
      onChanged();
    },
  });

  const setExpiry = (choice: string) => {
    if (choice === 'keep') return;
    change.mutate({
      expiresAt: choice === 'never' ? null : new Date(Date.now() + Number(choice) * DAY_MS).toISOString(),
    });
  };
  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    change.mutate({ password });
  };

  return (
    <div className="share-options">
      {link.expired && link.expiresAt && (
        <p className="field-error" role="status">
          This link ran out on {formatDateTime(link.expiresAt)} and no longer opens anything. Give it more time below to
          make it work again.
        </p>
      )}
      <label className="field">
        <span>Link runs out</span>
        <select
          value={link.expiresAt ? 'keep' : 'never'}
          onChange={(event) => setExpiry(event.target.value)}
          disabled={change.isPending}
        >
          <option value="never">Never</option>
          {link.expiresAt && (
            <option value="keep">
              {link.expired ? 'Ran out' : 'On'} {formatDateTime(link.expiresAt)}
            </option>
          )}
          {EXPIRY_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <form className="field" onSubmit={submitPassword}>
        <label htmlFor="share-password">
          <span>{link.hasPassword ? 'Change the password' : 'Ask readers for a password'}</span>
        </label>
        <div className="input-row">
          <input
            id="share-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            placeholder="At least 8 characters"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit" className="button" disabled={change.isPending}>
            {link.hasPassword ? 'Change' : 'Set password'}
          </button>
        </div>
      </form>
      {link.hasPassword && (
        <p className="muted">
          Readers are asked for a password. Send it to them some other way than the link.{' '}
          <button
            type="button"
            className="link-button danger"
            onClick={() => change.mutate({ password: null })}
            disabled={change.isPending}
          >
            Remove password
          </button>
        </p>
      )}
      {change.error && <ErrorMessage error={change.error} />}
    </div>
  );
}
