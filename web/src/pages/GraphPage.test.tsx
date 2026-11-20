import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { notebook } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { GraphPage } from './GraphPage';

const nodes = [
  { id: 'hub', title: 'Project Atlas' },
  { id: 'plan', title: 'Atlas plan' },
  { id: 'alone', title: 'Groceries' },
];
const edges = [
  { source: 'hub', target: 'plan' },
  { source: 'plan', target: 'hub' },
];
const lists = {
  'GET /api/notebooks': { body: [notebook({ id: 'w', name: 'Work' })] },
  'GET /api/tags': { body: [{ id: 't1', name: 'atlas', noteCount: 2 }] },
};

function Where() {
  const location = useLocation();
  return <output aria-label="Location">{location.pathname + location.search}</output>;
}

function renderPage(route = '/graph') {
  return renderWithProviders(
    <>
      <Where />
      <Routes>
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/notes/:noteId" element={<p>The note</p>} />
      </Routes>
    </>,
    { route },
  );
}

describe('GraphPage', () => {
  it('draws a dot for every note and a line for every link, and says the same as a list', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    const { container } = renderPage();

    const picture = await screen.findByRole('img', { name: /Graph of 3 notes and 2 links/ });
    expect(picture.querySelectorAll('circle')).toHaveLength(3);
    expect(picture.querySelectorAll('line')).toHaveLength(2);
    expect(screen.getByText('3 notes, 2 links.')).toBeInTheDocument();

    // The list carries what the picture shows: every note, where it links and what links to it.
    const list = screen.getByRole('list');
    const hub = within(list).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(hub).getAllByRole('link', { name: 'Project Atlas' })[0]).toHaveAttribute('href', '/notes/hub');
    expect(hub).toHaveTextContent('Links to Atlas plan');
    expect(hub).toHaveTextContent('Linked from Atlas plan');
    expect(
      within(list)
        .getByText(/no links/)
        .closest('li'),
    ).toHaveTextContent('Groceries');
    expect(container.querySelector('svg [tabindex], svg a')).toBeNull();
    await expectNoAxeViolations({ part: true });
  });

  it('opens a note when its dot is clicked', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    renderPage();

    const picture = await screen.findByRole('img');
    const dot = [...picture.querySelectorAll('.graph-node')].find((node) => node.textContent?.includes('Groceries'));
    await userEvent.click(dot as Element);
    expect(await screen.findByText('The note')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toHaveTextContent('/notes/alone');
  });

  it('zooms with the buttons and with the wheel, and goes back with Reset', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    renderPage();

    const picture = await screen.findByRole('img');
    const moved = () => picture.querySelector('g')?.getAttribute('transform');
    expect(moved()).toBe('translate(0 0) scale(1)');
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(moved()).toMatch(/scale\(1\.4\)$/);
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(moved()).toMatch(/scale\(1\)$/);

    // The wheel zooms the picture and does not scroll the page.
    expect(fireEvent.wheel(picture, { deltaY: -100 })).toBe(false);
    expect(moved()).toMatch(/scale\(1\.15\)$/);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(moved()).toBe('translate(0 0) scale(1)');
  });

  it('narrows the graph to a notebook and a tag kept in the address', async () => {
    const calls = mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    renderPage('/graph?tag=atlas');

    await screen.findByRole('img');
    expect(calls.find((call) => call.url.startsWith('/api/links/graph'))?.url).toBe('/api/links/graph?tag=atlas');
    await userEvent.selectOptions(screen.getByLabelText('Filter by notebook'), 'w');
    expect(screen.getByLabelText('Location')).toHaveTextContent('/graph?tag=atlas&notebook=w');
    await waitFor(() => expect(calls.at(-1)?.url).toBe('/api/links/graph?notebookId=w&tag=atlas'));
  });

  it('says when there are too many notes, and that the filters are the way to see the rest', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 1234 } } });
    renderPage();
    expect(await screen.findByText(/Too many notes to draw/)).toHaveTextContent(
      'these are the 3 notes edited last, out of 1,234. Pick a notebook or a tag above',
    );
  });

  it('has nothing to draw without notes', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes: [], edges: [], total: 0 } } });
    renderPage('/graph?tag=atlas');
    expect(await screen.findByText('No notes to draw')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
