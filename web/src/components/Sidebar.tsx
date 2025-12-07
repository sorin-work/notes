import { Link, useLocation, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';

export function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();

  const onNotes = location.pathname.startsWith('/notes');
  const view = onNotes ? (params.get('view') ?? (params.get('notebook') || params.get('tag') ? '' : 'all')) : '';

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
