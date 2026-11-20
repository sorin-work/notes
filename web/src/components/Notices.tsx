import { dismissNotice, useNotices } from '../lib/notices';

/** Shows the notices of lib/notices in a corner of the page. */
export function Notices() {
  const notices = useNotices();
  return (
    <div className="notices" role="status">
      {notices.map((notice) => (
        <div key={notice.id} className="notice">
          <span>{notice.text}</span>
          <button
            type="button"
            className="icon-button small"
            aria-label="Dismiss"
            onClick={() => dismissNotice(notice.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
