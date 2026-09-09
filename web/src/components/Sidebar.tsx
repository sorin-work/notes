import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { deleteNotebook, listNotebooks } from '../api/notebooks';
import { createNote } from '../api/notes';
import { listTags } from '../api/tags';
import type { Notebook } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { notebookTree, totalNotes } from '../lib/notebooks';
import { PencilIcon, TrashIcon } from './Icons';
import { ConfirmDialog } from './Modal';
import { NotebookDialog } from './NotebookDialog';

type NotebookAction =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'edit'; notebook: Notebook }
  | { kind: 'delete'; notebook: Notebook };

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [action, setAction] = useState<NotebookAction | null>(null);
  const [query, setQuery] = useState('');

  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tags = useQuery({ queryKey: ['tags'], queryFn: listTags });
  const tree = notebookTree(notebooks.data ?? []);

  const onNotes = location.pathname.startsWith('/notes');
  const view = onNotes ? (params.get('view') ?? (params.get('notebook') || params.get('tag') ? '' : 'all')) : '';
  const activeNotebook = onNotes ? params.get('notebook') : null;
  const activeTag = onNotes ? params.get('tag') : null;

  const newNote = useMutation({
    mutationFn: () =>
      createNote({
        notebookId: activeNotebook,
        tags: activeTag ? [activeTag] : undefined,
        pinned: view === 'pinned' || undefined,
        favorite: view === 'favorites' || undefined,
      }),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
      void queryClient.invalidateQueries({ queryKey: ['notebooks'] });
      navigate({ pathname: `/notes/${note.id}`, search: onNotes ? location.search : '' });
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

  const filterLink = (search: string, active: boolean, label: string, count?: number, className = '') => (
    <Link
      to={`/notes${search}`}
      className={`nav-item ${className} ${active ? 'active' : ''}`.trim()}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
    >
      <span className="nav-label">{label}</span>
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
          {filterLink('', view === 'all', 'All notes')}
          {filterLink('?view=pinned', view === 'pinned', 'Pinned')}
          {filterLink('?view=favorites', view === 'favorites', 'Favourites')}
          {filterLink('?view=unfiled', view === 'unfiled', 'Not in a notebook')}
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
                  {filterLink(`?notebook=${parent.id}`, activeNotebook === parent.id, parent.name, totalNotes(parent))}
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
          <button type="button" className="link-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>

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
      {action?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete “${action.notebook.name}”?`}
          message={
            <p>
              The notebook
              {tree.some((n) => n.id === action.notebook.id && n.children.length > 0) &&
                ' and the notebooks inside it'}{' '}
              will be deleted. Its notes move to the trash, where you can restore them for 30 days.
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
  onAction(kind: 'create' | 'edit' | 'delete'): void;
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
        aria-label={`Delete ${notebook.name}`}
        title="Delete"
        onClick={() => onAction('delete')}
      >
        <TrashIcon />
      </button>
    </span>
  );
}
