import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useRef, useState } from 'react';
import { changePassword, deleteAccount, logoutEverywhere, updateProfile } from '../api/auth';
import { deleteTag, listTags, renameTag } from '../api/tags';
import { createApiToken, listApiTokens, revokeApiToken } from '../api/tokens';
import { exportAll, importFiles } from '../api/transfer';
import type { ApiToken, CreatedApiToken, Tag, User } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ApiTokensStillWorking } from '../components/ApiTokensStillWorking';
import { ConfirmDialog, Modal } from '../components/Modal';
import { ErrorMessage } from '../components/States';
import { Theme, useTheme } from '../hooks/useTheme';
import { formatRelative } from '../lib/dates';

export function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="page settings-page">
      <h1>Settings</h1>
      <section className="card">
        <h2>Account</h2>
        {user && <ProfileForm user={user} />}
        <PasswordForm />
        <SessionsSection />
        {user && <DeleteAccountSection user={user} />}
      </section>
      <AppearanceSection />
      <ImportExportSection />
      <TagsSection />
      <ApiTokensSection />
    </div>
  );
}

function ProfileForm({ user }: { user: User }) {
  const { updateUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const emailChanged = email.trim().toLowerCase() !== user.email;
  const changed = emailChanged || name.trim() !== user.name;

  const save = useMutation({
    mutationFn: () => updateProfile({ name, email, ...(emailChanged && { currentPassword: password }) }),
    onSuccess: (saved) => {
      updateUser(saved);
      setName(saved.name);
      setEmail(saved.email);
      setPassword('');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form className="form narrow" onSubmit={submit}>
      <h3>Name and email</h3>
      <label className="field">
        <span>Name</span>
        <input
          autoComplete="name"
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      {emailChanged && (
        <label className="field">
          <span>Password, to confirm the new email</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
      )}
      {save.error && <ErrorMessage error={save.error} />}
      {save.isSuccess && !changed && <p className="success">Saved.</p>}
      <div className="form-actions start">
        <button type="submit" className="button button-primary" disabled={!changed || save.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const { renewSession } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: (result) => {
      // The old token died with the old password.
      renewSession(result);
      setCurrent('');
      setNext('');
      setRepeat('');
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMismatch(next !== repeat);
    if (next === repeat) change.mutate();
  };

  return (
    <form className="form narrow" onSubmit={submit}>
      <h3>Change password</h3>
      <label className="field">
        <span>Current password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>New password</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={8}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>Repeat new password</span>
        <input
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
          required
        />
      </label>
      {mismatch && <p className="field-error">The new passwords do not match.</p>}
      {change.error && <ErrorMessage error={change.error} />}
      {change.isSuccess && (
        <>
          <p className="success">Password changed. Every other browser and device has been signed out.</p>
          <ApiTokensStillWorking />
        </>
      )}
      <div className="form-actions start">
        <button type="submit" className="button button-primary" disabled={change.isPending}>
          Change password
        </button>
      </div>
    </form>
  );
}

function SessionsSection() {
  const { logout } = useAuth();
  const signOut = useMutation({ mutationFn: logoutEverywhere, onSuccess: logout });
  return (
    <div className="form narrow">
      <h3>Sessions</h3>
      <p className="muted">
        A login lasts a week. If you left one open somewhere, this signs you out in every browser and on every device,
        this one included. API tokens are not signed out: revoke those under API tokens.
      </p>
      {signOut.error && <ErrorMessage error={signOut.error} />}
      <div className="form-actions start">
        <button type="button" className="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
          Sign out everywhere
        </button>
      </div>
    </div>
  );
}

function DeleteAccountSection({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="form narrow">
      <h3>Delete account</h3>
      <p className="muted">Removes the account and everything in it. This cannot be undone.</p>
      <div className="form-actions start">
        <button type="button" className="button button-danger-quiet" onClick={() => setOpen(true)}>
          Delete account…
        </button>
      </div>
      {open && <DeleteAccountDialog user={user} onClose={() => setOpen(false)} />}
    </div>
  );
}

function DeleteAccountDialog({ user, onClose }: { user: User; onClose(): void }) {
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const download = useMutation({ mutationFn: exportAll });
  const remove = useMutation({ mutationFn: () => deleteAccount(password), onSuccess: logout });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    remove.mutate();
  };

  return (
    <Modal title="Delete your account?" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p>
          Every notebook, note, tag, earlier version and share link of {user.email} is deleted for good, the trash
          included. There is no way to get them back.
        </p>
        <p className="muted">
          Want a copy first? The export is a zip of your notes as Markdown files. It leaves out the trash and earlier
          versions.
        </p>
        <div className="form-actions start">
          <button type="button" className="button" onClick={() => download.mutate()} disabled={download.isPending}>
            {download.isPending ? 'Preparing…' : 'Export all notes'}
          </button>
        </div>
        {download.error && <ErrorMessage error={download.error} />}
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {remove.error && <ErrorMessage error={remove.error} />}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-danger" disabled={!password || remove.isPending}>
            Delete account
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  const options: { value: Theme; label: string }[] = [
    { value: 'system', label: 'Same as the system' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  return (
    <section className="card">
      <h2>Appearance</h2>
      <div className="radio-group" role="radiogroup" aria-label="Theme">
        {options.map((option) => (
          <label key={option.value} className="radio">
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={theme === option.value}
              onChange={() => setTheme(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </section>
  );
}

function ImportExportSection() {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);

  const upload = useMutation({
    mutationFn: () => importFiles(files),
    onSuccess: () => {
      setFiles([]);
      if (input.current) input.current.value = '';
      for (const key of ['notes', 'notebooks', 'tags']) void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
  const download = useMutation({ mutationFn: exportAll });

  return (
    <section className="card">
      <h2>Import and export</h2>
      <h3>Export</h3>
      <p className="muted">
        Download every note as a Markdown file in a zip. Notebooks become folders; tags, pins and dates are kept in each
        file’s front matter.
      </p>
      <button type="button" className="button" onClick={() => download.mutate()} disabled={download.isPending}>
        {download.isPending ? 'Preparing…' : 'Export all notes'}
      </button>
      {download.error && <ErrorMessage error={download.error} />}

      <h3>Import</h3>
      <p className="muted">
        Markdown (.md), text files or a zip of them, for example an export from this app or an Obsidian vault. Folders
        become notebooks.
      </p>
      <div className="input-row">
        <input
          ref={input}
          type="file"
          aria-label="Files to import"
          multiple
          accept=".md,.markdown,.txt,.zip"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        <button
          type="button"
          className="button button-primary"
          onClick={() => upload.mutate()}
          disabled={files.length === 0 || upload.isPending}
        >
          {upload.isPending ? 'Importing…' : 'Import'}
        </button>
      </div>
      {upload.error && <ErrorMessage error={upload.error} />}
      {upload.data && (
        <div className="import-result" role="status">
          <p className="success">
            Imported {upload.data.imported} {upload.data.imported === 1 ? 'note' : 'notes'}
            {upload.data.notebooksCreated > 0 && ` and created ${upload.data.notebooksCreated} notebooks`}.
          </p>
          {upload.data.skipped.length > 0 && (
            <details>
              <summary>{upload.data.skipped.length} files skipped</summary>
              <ul>
                {upload.data.skipped.map((skip) => (
                  <li key={skip.file}>
                    {skip.file}: {skip.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

function TagsSection() {
  const queryClient = useQueryClient();
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<Tag | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    void queryClient.invalidateQueries({ queryKey: ['notes'] });
    void queryClient.invalidateQueries({ queryKey: ['note'] });
  };
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameTag(id, name),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: () => {
      setRemoving(null);
      refresh();
    },
  });

  return (
    <section className="card">
      <h2>Tags</h2>
      <p className="muted">Renaming a tag to the name of another one merges them.</p>
      {tags.data?.length === 0 && <p className="muted">No tags yet. Add tags under a note’s title.</p>}
      <ul className="tag-admin">
        {tags.data?.map((tag) => (
          <li key={tag.id}>
            {editing?.id === tag.id ? (
              <form
                className="input-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  rename.mutate(editing);
                }}
              >
                <input
                  aria-label={`New name for ${tag.name}`}
                  value={editing.name}
                  autoFocus
                  onChange={(event) => setEditing({ id: tag.id, name: event.target.value })}
                />
                <button type="submit" className="button button-primary" disabled={rename.isPending}>
                  Save
                </button>
                <button type="button" className="button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span>
                  #{tag.name} <span className="muted">· {tag.noteCount}</span>
                </span>
                <span className="tag-admin-actions">
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => setEditing({ id: tag.id, name: tag.name })}
                  >
                    Rename
                  </button>
                  <button type="button" className="link-button danger" onClick={() => setRemoving(tag)}>
                    Delete
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {rename.error && <ErrorMessage error={rename.error} />}
      {removing && (
        <ConfirmDialog
          title={`Delete #${removing.name}?`}
          message={<p>The tag is removed from {removing.noteCount} notes. The notes themselves are not deleted.</p>}
          confirmLabel="Delete tag"
          danger
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onCancel={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

function ApiTokensSection() {
  const queryClient = useQueryClient();
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: listApiTokens });
  const [name, setName] = useState('');
  const [readOnly, setReadOnly] = useState(false);
  const [password, setPassword] = useState('');
  const [created, setCreated] = useState<CreatedApiToken | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
  const create = useMutation({
    mutationFn: () => createApiToken(name, readOnly, password),
    onSuccess: (token) => {
      setCreated(token);
      setCopied(false);
      setName('');
      setReadOnly(false);
      setPassword('');
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeApiToken(id),
    onSuccess: (_result, id) => {
      setRevoking(null);
      if (created?.id === id) setCreated(null);
      refresh();
    },
  });

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="card">
      <h2>API tokens</h2>
      <p className="muted">
        For scripts. A request that sends a token as <code>Authorization: Bearer nt_…</code> is treated as yours. A
        token can read and change notes, or only read them if it is read-only. It cannot change the account or manage
        tokens. Tokens do not expire, and signing out everywhere or changing the password leaves them alone, so revoke
        the ones you no longer use. Making one takes your password, because it outlives every login.
      </p>
      {tokens.error && <ErrorMessage error={tokens.error} />}
      {tokens.data?.length === 0 && <p className="muted">No tokens yet.</p>}
      <ul className="tag-admin">
        {tokens.data?.map((token) => (
          <li key={token.id}>
            <span>
              {token.name}{' '}
              <span className="muted">
                {token.readOnly && '· read-only '}· made {formatRelative(token.createdAt)} ·{' '}
                {token.lastUsedAt ? `last used ${formatRelative(token.lastUsedAt)}` : 'never used'}
              </span>
            </span>
            <span className="tag-admin-actions">
              <button type="button" className="link-button danger" onClick={() => setRevoking(token)}>
                Revoke
              </button>
            </span>
          </li>
        ))}
      </ul>

      {created && (
        <div className="import-result" role="status">
          <label className="field">
            <span>The token for “{created.name}”. Copy it now, it is not shown again.</span>
            <div className="input-row">
              <input
                readOnly
                value={created.token}
                aria-label="New API token"
                onFocus={(event) => event.target.select()}
              />
              <button type="button" className="button" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </label>
        </div>
      )}

      <form
        className="form narrow"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h3>New token</h3>
        <label className="field">
          <span>Token name</span>
          <input
            maxLength={100}
            placeholder="What it is for, such as backup script"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label className="radio">
          <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
          Read-only
        </label>
        <label className="field">
          <span>Password, to create the token</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {create.error && <ErrorMessage error={create.error} />}
        <div className="form-actions start">
          <button type="submit" className="button button-primary" disabled={create.isPending}>
            Create token
          </button>
        </div>
      </form>

      {revoke.error && <ErrorMessage error={revoke.error} />}
      {revoking && (
        <ConfirmDialog
          title={`Revoke “${revoking.name}”?`}
          message={<p>Whatever uses this token stops working at once. A revoked token cannot be brought back.</p>}
          confirmLabel="Revoke token"
          danger
          busy={revoke.isPending}
          onConfirm={() => revoke.mutate(revoking.id)}
          onCancel={() => setRevoking(null)}
        />
      )}
    </section>
  );
}
