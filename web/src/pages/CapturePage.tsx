import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { createNote } from '../api/notes';
import { ErrorMessage } from '../components/States';
import { captureDraft } from '../lib/capture';

/**
 * `/capture?title=&url=`: a new note about a web page, filled in from the
 * address and ready to save. It is what a "save this page" bookmarklet opens.
 *
 * Nothing is created until the button is pressed. Any site can send a
 * signed-in visitor to this address, so a page that saved by itself would
 * let strangers put notes into the account. For the same reason the draft
 * takes very little from the link, see captureDraft.
 */
export function CapturePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft] = useState(() => captureDraft(params));
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);

  const save = useMutation({
    mutationFn: () => createNote({ title, content }),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      navigate(`/notes/${note.id}`, { replace: true });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <div className="page">
      <h1>Save a page as a note</h1>
      <form className="form capture-form" onSubmit={submit}>
        <label className="field">
          <span>Title</span>
          <input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>Text</span>
          <textarea rows={10} value={content} onChange={(event) => setContent(event.target.value)} />
        </label>
        {draft.urlDropped && (
          <p className="field-error" role="status">
            The address that came with this link was left out, because it is not a plain http or https web address.
          </p>
        )}
        <p className="muted">Nothing is saved until you press the button. You can go on writing in the note after.</p>
        {save.error && <ErrorMessage error={save.error} />}
        <div className="form-actions start">
          <button type="submit" className="button button-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save note'}
          </button>
          <Link to="/notes" className="button">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
