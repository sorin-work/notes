import { useRef } from 'react';
import type { Attachment } from '../api/types';
import { ErrorMessage } from './States';

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  attachments: Attachment[];
  readOnly: boolean;
  /** Files still on their way up. */
  uploading: number;
  error: unknown;
  onAttach(files: File[]): void;
  onRemove(id: string): void;
}

/** The files of a note, with a way to add one and to remove one. Pasting or dropping into the text adds them too. */
export function AttachmentsPanel({ attachments, readOnly, uploading, error, onAttach, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null);
  if (readOnly && attachments.length === 0) return null;
  return (
    <section className="attachments" aria-labelledby="attachments-heading">
      <div className="attachments-header">
        <h2 id="attachments-heading">Attachments</h2>
        {!readOnly && (
          <>
            <button type="button" className="button" onClick={() => input.current?.click()}>
              Attach a file
            </button>
            <input
              ref={input}
              type="file"
              hidden
              multiple
              aria-label="Files to attach"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
              onChange={(event) => {
                onAttach(Array.from(event.target.files ?? []));
                event.target.value = '';
              }}
            />
          </>
        )}
      </div>
      {attachments.length === 0 && uploading === 0 && (
        <p className="muted">Paste or drop an image or a PDF into the text, or attach one here.</p>
      )}
      {uploading > 0 && (
        <p className="muted" role="status">
          Uploading {uploading} {uploading === 1 ? 'file' : 'files'}…
        </p>
      )}
      {error ? <ErrorMessage error={error} /> : null}
      {attachments.length > 0 && (
        <ul className="attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <a href={attachment.url} target="_blank" rel="noreferrer noopener">
                {attachment.fileName}
              </a>
              <span className="muted"> {size(attachment.size)}</span>
              {!readOnly && (
                <button
                  type="button"
                  className="button button-danger-quiet small"
                  aria-label={`Remove ${attachment.fileName}`}
                  onClick={() => onRemove(attachment.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
