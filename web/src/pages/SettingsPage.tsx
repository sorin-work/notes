import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useRef, useState } from 'react';
import { changePassword } from '../api/auth';
import { deleteTag, listTags, renameTag } from '../api/tags';
import { exportAll, importFiles } from '../api/transfer';
import type { Tag } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/Modal';
import { ErrorMessage } from '../components/States';

export function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="page settings-page">
      <h1>Settings</h1>
      <section className="card">
        <h2>Account</h2>
        <p>
          {user?.name} · <span className="muted">{user?.email}</span>
        </p>
        <PasswordForm />
      </section>
      <ImportExportSection />
      <TagsSection />
    </div>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({
    mutationFn: () => changePassword(current, next),
    onSuccess: () => {
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
      {change.isSuccess && <p className="success">Password changed.</p>}
      <div className="form-actions start">
        <button type="submit" className="button button-primary" disabled={change.isPending}>
          Change password
        </button>
      </div>
    </form>
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
