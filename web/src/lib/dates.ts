const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "Mar 3" or "Mar 3, 2025". */
export function formatRelative(value: string | Date, now = new Date()): string {
  const date = new Date(value);
  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY);
  if (days === 0) return `${Math.floor(diff / HOUR)} h ago`;
  if (days === 1) return 'yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatDateTime(value: string | Date): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function daysUntil(value: string | Date, now = new Date()): number {
  return Math.max(0, Math.ceil((new Date(value).getTime() - now.getTime()) / DAY));
}
