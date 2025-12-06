import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="full-page-center">
      <div className="empty-state">
        <p className="empty-title">Page not found</p>
        <Link to="/notes">Back to your notes</Link>
      </div>
    </div>
  );
}
