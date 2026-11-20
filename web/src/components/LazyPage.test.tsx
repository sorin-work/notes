import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { renderWithProviders } from '../test/render';
import { lazyPage } from './LazyPage';

function Graph() {
  return <h1>Graph</h1>;
}

/** A page whose code is fetched when it is opened, the way App.tsx does it, with a connection that can be down. */
function setUp() {
  const connection = { up: false, fetches: 0 };
  const Page = lazyPage(async () => {
    connection.fetches += 1;
    if (!connection.up) throw new TypeError('Failed to fetch dynamically imported module');
    return Graph;
  });
  renderWithProviders(
    <Routes>
      <Route
        element={
          <>
            <nav aria-label="Main">
              <Link to="/notes">All notes</Link>
              <Link to="/graph">Graph</Link>
            </nav>
            <main>
              <Outlet />
            </main>
          </>
        }
      >
        <Route path="/graph" element={<Page />} />
        <Route path="/notes" element={<p>The notes</p>} />
      </Route>
    </Routes>,
    { route: '/graph' },
  );
  return connection;
}

describe('lazyPage', () => {
  beforeEach(() => {
    // React reports every error a boundary catches. These are the ones the tests cause.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows the page once its code has arrived', async () => {
    const connection = setUp();
    connection.up = true;
    // The first fetch started with the first draw, before the connection came up. Opening the page again fetches again.
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('link', { name: 'All notes' }));
    await userEvent.click(screen.getByRole('link', { name: 'Graph' }));
    expect(await screen.findByRole('heading', { name: 'Graph' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(connection.fetches).toBe(2);
  });

  it('keeps the layout when the code cannot be fetched, says so, and fetches again on "Try again"', async () => {
    const connection = setUp();

    const alert = await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'This page could not be loaded' })).toBeInTheDocument();
    expect(alert).toHaveTextContent(
      'The connection may be down, or the app has been updated since this tab was opened.',
    );
    expect(within(alert).getByRole('button', { name: 'Reload the app' })).toBeInTheDocument();
    // The rest of the app is still there and still works.
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    await expectNoAxeViolations({ part: true });

    // Still down: the message comes back, after one more fetch and no more.
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByRole('alert');
    expect(connection.fetches).toBe(2);

    connection.up = true;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Graph' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(connection.fetches).toBe(3);
  });

  it('lets the other pages be opened while one cannot be loaded', async () => {
    setUp();
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('link', { name: 'All notes' }));
    expect(await screen.findByText('The notes')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
