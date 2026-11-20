import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="full-page-center">
      <div className="empty-state">
        <h1 className="empty-title">Page not found</h1>
        <Link to="/notes">Back to your notes</Link>
      </div>
    </main>
  );
}
