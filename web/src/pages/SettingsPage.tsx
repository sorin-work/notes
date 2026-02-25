import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { exportAll, importFiles } from '../api/transfer';
import { useAuth } from '../auth/AuthContext';
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
      </section>
      <ImportExportSection />
    </div>
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
        </div>
      )}
    </section>
  );
}
