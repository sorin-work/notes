import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router';
import { listNotebooks } from '../api/notebooks';
import { useAuth } from '../auth/AuthContext';
import { notebookTree, totalNotes } from '../lib/notebooks';

export function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();

  const notebooks = useQuery({ queryKey: ['notebooks'], queryFn: listNotebooks });
  const tree = notebookTree(notebooks.data ?? []);

  const onNotes = location.pathname.startsWith('/notes');
  const view = onNotes ? (params.get('view') ?? (params.get('notebook') || params.get('tag') ? '' : 'all')) : '';
  const activeNotebook = onNotes ? params.get('notebook') : null;

  const filterLink = (search: string, active: boolean, label: string, count?: number, className = '') => (
    <Link
      to={`/notes${search}`}
      className={`nav-item ${className} ${active ? 'active' : ''}`.trim()}
      aria-current={active ? 'page' : undefined}
    >
      <span className="nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="count">{count}</span>}
    </Link>
  );

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-top">
        <Link to="/notes" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} /> Notes
        </Link>
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
          </div>
          {notebooks.data?.length === 0 && <p className="nav-empty">No notebooks yet.</p>}
          <ul className="notebook-tree">
            {tree.map((parent) => (
              <li key={parent.id}>
                <div className="nav-row">
                  {filterLink(`?notebook=${parent.id}`, activeNotebook === parent.id, parent.name, totalNotes(parent))}
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
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="sidebar-bottom">
        <div className="account">
          <span className="account-name" title={user?.email}>
            {user?.name}
          </span>
          <button type="button" className="link-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
