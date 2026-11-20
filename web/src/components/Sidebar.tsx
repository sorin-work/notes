import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { deleteNotebook, listNotebooks } from '../api/notebooks';
import { createNote, listNotes, openDailyNote } from '../api/notes';
import { listTags } from '../api/tags';
import type { Notebook, NoteChanges } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { todaysNote } from '../lib/days';
import { dropStashes } from '../lib/draftStash';
import { leavingTemplates, newNoteFor, NO_NOTEBOOK, readFilters } from '../lib/filters';
import { notebookTree, totalNotes, trashedWith } from '../lib/notebooks';
import { fromTemplate } from '../lib/templates';
import { discardUnsavedWork, saveUnsavedWork } from '../lib/unsavedWork';
import { LinkIcon, PencilIcon, TrashIcon } from './Icons';
import { ConfirmDialog } from './Modal';
import { NotebookDialog } from './NotebookDialog';
import { ShareDialog } from './ShareDialog';
import { ErrorMessage } from './States';

type NotebookAction =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'edit'; notebook: Notebook }
  | { kind: 'share'; notebook: Notebook }
  | { kind: 'delete'; notebook: Notebook };

/** Why anyone with a link can read the notes of a notebook, or null when nobody can. */
function publicBecause(notebook: Notebook): string | null {
  const through = notebook.sharedThrough;
  if (!through) return null;
  return through.id === notebook.id
    ? 'Shared with a link: anyone who has it can read the notes in here'
    : `Public through the shared notebook “${through.name}”`;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [action, setAction] = useState<NotebookAction | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [chosenTemplate, setChosenTemplate] = useState('');

  // Once the session has ended nothing can be saved, so what is unsaved goes
  // first. If that does not work, signing out would throw it away, and that
  // is for the user to decide.
  const signOut = async () => {
    if (await saveUnsavedWork()) logout();
    else setConfirmingSignOut(true);
  };
  const [query, setQuery] = useState('');

  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });
  const tree = notebookTree(notebooks.data ?? []);

  // Only the note list is filtered. On the other pages nothing in here is the current place.
  const onNotes = location.pathname.startsWith('/notes');
  const shown = readFilters(onNotes ? params : new URLSearchParams());
  const { notebook: activeNotebook, tag: activeTag, view } = shown;
  const showsAll = onNotes && !activeNotebook && !activeTag && !view;

  // Under the 'notes' key, so that whatever refreshes the lists refreshes this one too.
  const templates = useQuery({
    queryKey: ['notes', 'templates'],
    queryFn: () => listNotes({ templates: true, sort: 'title', pageSize: 100 }),
  });

  const newNote = useMutation({
    mutationFn: (start: NoteChanges | void) => createNote(start ?? newNoteFor(shown)),
    onSuccess: (note, start) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      setChosenTemplate('');
      // A note is not shown in the list of templates, so that view is left behind.
      const search = onNotes && !note.isTemplate ? leavingTemplates(location.search) : onNotes ? location.search : '';
      // A note from a template starts untitled, so the cursor goes to its title.
      navigate({ pathname: `/notes/${note.id}`, search }, { state: start?.templateId ? { focusTitle: true } : null });
      onNavigate?.();
    },
  });

  // "Today" is a day here, in the browser. The server finds the note of that day or makes it.
  const today = useMutation({
    mutationFn: () => openDailyNote(todaysNote()),
    onSuccess: (note) => {
      for (const key of ['notes', 'notebooks', 'tags']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      // Shown among all notes: the list that was open may be one the note is not in.
      navigate(`/notes/${note.id}`);
      onNavigate?.();
    },
  });

  const removeNotebook = useMutation({
    mutationFn: (id: string) => deleteNotebook(id),
    onSuccess: (_result, id) => {
      for (const key of ['notebooks', 'notes', 'trash', 'tags']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      setAction(null);
      if (activeNotebook === id || tree.some((n) => n.id === id && n.children.some((c) => c.id === activeNotebook))) {
        navigate('/notes');
      }
    },
  });

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
    onNavigate?.();
  };

  const filterLink = (
    search: string,
    active: boolean,
    label: string,
    count?: number,
    className = '',
    /** Why the notebook is public, when it is. */
    publicTitle: string | null = null,
  ) => (
    <Link
      to={`/notes${search}`}
      className={`nav-item ${className} ${active ? 'active' : ''}`.trim()}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
    >
      <span className="nav-label">{label}</span>
      {publicTitle && (
        <span className="public-mark" title={publicTitle}>
          public
        </span>
      )}
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </Link>
  );

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-top">
        <Link to="/notes" className="brand" onClick={onNavigate}>
          <img src="/favicon.svg" alt="" width={22} height={22} /> Notes
        </Link>
        <button
          type="button"
          className="button button-primary new-note"
          onClick={() => newNote.mutate()}
          disabled={newNote.isPending}
          title="New note (Alt+N)"
        >
          + New note
        </button>
        {templates.data && templates.data.items.length > 0 && (
          // Choosing is not creating: the arrow keys on a closed select change
          // it at once, so the note is made only by the button.
          <form
            className="new-from-template"
            onSubmit={(event) => {
              event.preventDefault();
              // The new note goes into the notebook that is being looked at. Its tags come from the template.
              if (chosenTemplate) newNote.mutate(fromTemplate(chosenTemplate, newNoteFor(shown).notebookId));
            }}
          >
            <select
              aria-label="New from template"
              value={chosenTemplate}
              disabled={newNote.isPending}
              onChange={(event) => setChosenTemplate(event.target.value)}
            >
              <option value="">New from template…</option>
              {templates.data.items.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.title}
                </option>
              ))}
            </select>
            <button type="submit" className="button" disabled={!chosenTemplate || newNote.isPending}>
              Create
            </button>
          </form>
        )}
        {newNote.error && <ErrorMessage error={newNote.error} />}
        <form role="search" onSubmit={submitSearch}>
          <input
            type="search"
            id="global-search"
            className="search-input"
            placeholder="Search notes  /"
            aria-label="Search notes"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
      </div>

      <div className="sidebar-scroll">
        <div className="nav-section">
          <button
            type="button"
            className="nav-item nav-button"
            title="Open today’s note, or start it"
            disabled={today.isPending}
            onClick={() => today.mutate()}
          >
            <span className="nav-label">Today</span>
          </button>
          {today.error && (
            <p className="nav-empty" role="alert">
              Today’s note could not be opened.
            </p>
          )}
          {filterLink('', showsAll, 'All notes')}
          {filterLink('?view=pinned', view === 'pinned', 'Pinned')}
          {filterLink('?view=favorites', view === 'favorites', 'Favourites')}
          {filterLink(`?notebook=${NO_NOTEBOOK}`, activeNotebook === NO_NOTEBOOK, 'Not in a notebook')}
          {filterLink('?view=templates', view === 'templates', 'Templates')}
        </div>

        <div className="nav-section">
          <div className="nav-heading">
            <span>Notebooks</span>
            <button
              type="button"
              className="icon-button small"
              aria-label="New notebook"
              title="New notebook"
              onClick={() => setAction({ kind: 'create', parentId: null })}
            >
              +
            </button>
          </div>
          {notebooks.data?.length === 0 && <p className="nav-empty">No notebooks yet.</p>}
          <ul className="notebook-tree">
            {tree.map((parent) => (
              <li key={parent.id}>
                <div className="nav-row">
                  {filterLink(
                    `?notebook=${parent.id}`,
                    activeNotebook === parent.id,
                    parent.name,
                    totalNotes(parent),
                    '',
                    publicBecause(parent),
                  )}
                  <NotebookMenu
                    notebook={parent}
                    canNest
                    onAction={(kind) =>
                      setAction(kind === 'create' ? { kind, parentId: parent.id } : { kind, notebook: parent })
                    }
                  />
                </div>
                {parent.children.length > 0 && (
                  <ul>
                    {parent.children.map((child) => (
                      <li key={child.id} className="nav-row">
                        {filterLink(
                          `?notebook=${child.id}`,
                          activeNotebook === child.id,
                          child.name,
                          child.noteCount,
                          'nested',
                          publicBecause(child),
                        )}
                        <NotebookMenu
                          notebook={child}
                          onAction={(kind) => kind !== 'create' && setAction({ kind, notebook: child })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>

        {tags.data && tags.data.length > 0 && (
          <div className="nav-section">
            <div className="nav-heading">
              <span>Tags</span>
            </div>
            <div className="tag-cloud">
              {tags.data.map((tag) => (
                <Link
                  key={tag.id}
                  to={`/notes?tag=${encodeURIComponent(tag.name)}`}
                  className={activeTag === tag.name ? 'tag-link active' : 'tag-link'}
                  onClick={onNavigate}
                >
                  #{tag.name}
                  <span className="count">{tag.noteCount}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-bottom">
        <NavLink to="/trash" className="nav-item" onClick={onNavigate}>
          Trash
        </NavLink>
        <NavLink to="/settings" className="nav-item" onClick={onNavigate}>
          Settings
        </NavLink>
        <div className="account">
          <span className="account-name" title={user?.email}>
            {user?.name}
          </span>
          <button type="button" className="link-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>

      {confirmingSignOut && (
        <ConfirmDialog
          title="Sign out without saving?"
          message={
            <p>
              Your latest changes to the open note could not be saved. If you sign out now, they are thrown away. Stay
              signed in to try again.
            </p>
          }
          confirmLabel="Sign out and discard"
          danger
          onConfirm={() => {
            discardUnsavedWork();
            if (user) dropStashes(user.id);
            logout();
          }}
          onCancel={() => setConfirmingSignOut(false)}
        />
      )}
      {(action?.kind === 'create' || action?.kind === 'edit') && (
        <NotebookDialog
          notebooks={notebooks.data ?? []}
          notebook={action.kind === 'edit' ? action.notebook : undefined}
          parentId={action.kind === 'create' ? action.parentId : undefined}
          onClose={() => setAction(null)}
          onSaved={(saved) => {
            if (action.kind === 'create') navigate(`/notes?notebook=${saved.id}`);
          }}
        />
      )}
      {action?.kind === 'share' && <ShareDialog notebookId={action.notebook.id} onClose={() => setAction(null)} />}
      {action?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${action.notebook.name}”?`}
          message={
            <p>
              The notebook
              {tree.some((n) => n.id === action.notebook.id && n.children.length > 0) &&
                ' and the notebooks inside it'}{' '}
              will be deleted. {trashedWith(notebooks.data ?? [], action.notebook.id)}
            </p>
          }
          confirmLabel="Delete notebook"
          danger
          busy={removeNotebook.isPending}
          onConfirm={() => removeNotebook.mutate(action.notebook.id)}
          onCancel={() => setAction(null)}
        />
      )}
    </nav>
  );
}

function NotebookMenu({
  notebook,
  canNest,
  onAction,
}: {
  notebook: Notebook;
  canNest?: boolean;
  onAction(kind: 'create' | 'edit' | 'share' | 'delete'): void;
}) {
  return (
    <span className="nav-actions">
      {canNest && (
        <button
          type="button"
          className="icon-button small"
          aria-label={`New notebook inside ${notebook.name}`}
          title="New notebook inside"
          onClick={() => onAction('create')}
        >
          +
        </button>
      )}
      <button
        type="button"
        className="icon-button small"
        aria-label={`Edit ${notebook.name}`}
        title="Rename or move"
        onClick={() => onAction('edit')}
      >
        <PencilIcon />
      </button>
      <button
        type="button"
        className="icon-button small"
        aria-label={`Share ${notebook.name}`}
        title="Share with a link"
        onClick={() => onAction('share')}
      >
        <LinkIcon />
      </button>
      <button
        type="button"
        className="icon-button small"
        aria-label={`Delete ${notebook.name}`}
        title="Delete"
        onClick={() => onAction('delete')}
      >
        <TrashIcon />
      </button>
    </span>
  );
}
