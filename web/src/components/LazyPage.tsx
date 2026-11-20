import { Component, type ComponentType, lazy, type ReactNode, Suspense, useState } from 'react';
import { Spinner } from './States';

interface BoundaryProps {
  /** Told when the page fails, before anything is shown. */
  onError(): void;
  /** Asked to bring the page again. */
  onRetry(): void;
  children: ReactNode;
}

/**
 * Catches a page whose code could not be fetched, or that broke while it
 * was drawn. Without it such a failure takes the whole app off the screen.
 * It sits inside the layout, so the sidebar stays and every other page can
 * still be opened.
 */
class PageBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  retry = () => {
    this.props.onRetry();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page">
        <h1>This page could not be loaded</h1>
        <div className="error-box" role="alert">
          <p>
            The connection may be down, or the app has been updated since this tab was opened. Try again, and reload the
            app if that does not help.
          </p>
          <div className="form-actions start">
            <button type="button" className="button" onClick={this.retry}>
              Try again
            </button>
            <button type="button" className="button" onClick={() => window.location.reload()}>
              Reload the app
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * A page whose code is only fetched when the page is opened. `load` is the
 * dynamic import. While it runs there is a spinner, and when it fails there
 * is a message with a way to try again, both in place of the page only.
 */
export function lazyPage(load: () => Promise<ComponentType>) {
  const make = () => lazy(async () => ({ default: await load() }));
  // What to draw next time. A lazy component keeps its failure for good, so after one a new one is made. It does
  // not fetch anything until it is drawn: by "Try again", or by the page being opened again.
  let current = make();

  return function LazyPage() {
    const [Page, setPage] = useState(() => current);
    return (
      <PageBoundary
        onError={() => {
          current = make();
        }}
        onRetry={() => setPage(() => current)}
      >
        <Suspense fallback={<Spinner />}>
          <Page />
        </Suspense>
      </PageBoundary>
    );
  };
}
