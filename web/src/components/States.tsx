import { ReactNode } from 'react';
import { ApiError } from '../api/client';
import { offlineWritingAvailable } from '../lib/outbox';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner-dot" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function FullPageSpinner() {
  return (
    <main className="full-page-center">
      <Spinner />
    </main>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * A ref for the heading of a message that takes the place of a form. The
 * focus was in that form, and would otherwise be nowhere once it is gone.
 */
export function focusOnce(heading: HTMLElement | null): void {
  heading?.focus();
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

/** Said where something cannot be shown without a connection. */
export function NeedsConnection({ children }: { children: ReactNode }) {
  return <p className="muted needs-connection">{children}</p>;
}

/** The line at the top of the app while there is no connection. */
export function OfflineBanner() {
  return (
    <div className="offline-banner" role="status">
      You are offline. Notes you have opened on this device can still be read, but what you see may be out of date.
      Search, backlinks and history need a connection.
      {!offlineWritingAvailable() &&
        ' Changes cannot be kept on this device here: that needs a secure (HTTPS) address, so they are saved only once there is a connection.'}
    </div>
  );
}
