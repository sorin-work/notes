import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../test/axe';
import { notebook } from '../test/fixtures';
import { mockFetch, renderWithProviders } from '../test/render';
import { GraphPage } from './GraphPage';

const nodes = [
  { id: 'hub', title: 'Project Atlas', links: 2 },
  { id: 'plan', title: 'Atlas plan', links: 2 },
  { id: 'alone', title: 'Groceries', links: 0 },
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

/** Where a dot is drawn, read from the picture. */
function placeOf(dot: Element | undefined) {
  const [, x, y] = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(dot?.getAttribute('transform') ?? '') ?? [];
  return { x: Number(x), y: Number(y) };
}
const dotOf = (picture: Element, title: string) =>
  [...picture.querySelectorAll('.graph-node')].find((node) => node.querySelector('title')?.textContent === title);
const apart = (picture: Element, a: string, b: string) => {
  const [from, to] = [placeOf(dotOf(picture, a)), placeOf(dotOf(picture, b))];
  return Math.hypot(from.x - to.x, from.y - to.y);
};

describe('GraphPage', () => {
  it('draws a dot for every note and a line for every link, and says the same as a list', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    const { container } = renderPage();

    const picture = await screen.findByRole('img', { name: /Graph of 3 notes and 2 links/ });
    expect(picture.querySelectorAll('.graph-node circle')).toHaveLength(3);
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
    await userEvent.click(dotOf(picture, 'Groceries') as Element);
    expect(await screen.findByText('The note')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toHaveTextContent('/notes/alone');
  });

  it('opens a note for a click that lands near its dot, on the room every dot has around it', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    renderPage();

    const picture = await screen.findByRole('img');
    const room = picture.querySelector('.graph-hit[data-note="plan"]') as Element;
    // 24 pixels across, whatever the size of the dot inside it.
    expect(room).toHaveAttribute('r', '12');
    await userEvent.click(room);
    await waitFor(() => expect(screen.getByLabelText('Location')).toHaveTextContent('/notes/plan'));
  });

  it('says that it is laying out the picture, with the list already there, before it draws', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    renderPage();

    expect(await screen.findByText('Laying out the picture…')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toHaveTextContent('Project Atlas');
    expect(await screen.findByRole('img')).toBeInTheDocument();
    expect(screen.queryByText('Laying out the picture…')).not.toBeInTheDocument();
  });

  it('zooms with the buttons, moving the dots apart and leaving their size alone', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    renderPage();

    const picture = await screen.findByRole('img');
    // One unit of the picture is one pixel of the screen, so the sizes written in it are the sizes seen.
    expect(picture).not.toHaveAttribute('viewBox');
    const sizes = () => [...picture.querySelectorAll('.graph-node circle')].map((dot) => Number(dot.getAttribute('r')));
    const before = { sizes: sizes(), apart: apart(picture, 'Project Atlas', 'Groceries') };
    expect(Math.min(...before.sizes)).toBeGreaterThanOrEqual(4);
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%');

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('140%');
    expect(apart(picture, 'Project Atlas', 'Groceries') / before.apart).toBeCloseTo(1.4, 1);
    expect(sizes()).toEqual(before.sizes);

    // The buttons work from the keyboard.
    screen.getByRole('button', { name: 'Zoom out' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('71%');
    expect(sizes()).toEqual(before.sizes);

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%');
    expect(apart(picture, 'Project Atlas', 'Groceries')).toBeCloseTo(before.apart, 0);
  });

  it('leaves the plain wheel to the page, and zooms with Ctrl or Cmd by as much as the wheel turned', async () => {
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes, edges, total: 3 } } });
    renderPage();

    const picture = await screen.findByRole('img');
    const level = () => screen.getByLabelText('Zoom level').textContent;
    // Not prevented, so the page scrolls, and the picture stays as it is.
    expect(fireEvent.wheel(picture, { deltaY: 100 })).toBe(true);
    expect(fireEvent.wheel(picture, { deltaY: -100 })).toBe(true);
    expect(level()).toBe('100%');

    expect(fireEvent.wheel(picture, { deltaY: -100, ctrlKey: true })).toBe(false);
    expect(level()).toBe('122%');
    expect(fireEvent.wheel(picture, { deltaY: 100, metaKey: true })).toBe(false);
    expect(level()).toBe('100%');
    // A pinch comes as many small steps. A step of nothing does nothing.
    fireEvent.wheel(picture, { deltaY: 0, ctrlKey: true });
    expect(level()).toBe('100%');
    fireEvent.wheel(picture, { deltaY: -5, ctrlKey: true });
    expect(level()).toBe('101%');
    // A hard swipe is one step, not the end of the scale.
    fireEvent.wheel(picture, { deltaY: -5000, ctrlKey: true });
    expect(Number.parseInt(level() ?? '', 10)).toBeLessThan(200);
  });

  it('shows titles for many notes only when one is pointed at or focused in the list, or after zooming in', async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({ id: `n${index}`, title: `Note ${index}`, links: 0 }));
    const chain = [{ source: 'n0', target: 'n1' }];
    mockFetch({ ...lists, 'GET /api/links/graph': { body: { nodes: many, edges: chain, total: 60 } } });
    renderPage();

    const picture = await screen.findByRole('img');
    const standsOut = (title: string) => dotOf(picture, title)?.classList.contains('near');
    // However many notes share the picture, a dot stays big enough to see and to click.
    const sizes = [...picture.querySelectorAll('.graph-node circle')].map((dot) => Number(dot.getAttribute('r')));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(4);
    expect(picture.querySelectorAll('.graph-hit[r="12"]')).toHaveLength(60);
    expect(picture).not.toHaveClass('graph-labelled');
    expect(standsOut('Note 0')).toBe(false);

    // Pointed at: the note and the note it is linked with.
    await userEvent.hover(dotOf(picture, 'Note 0') as Element);
    expect(standsOut('Note 0')).toBe(true);
    expect(standsOut('Note 1')).toBe(true);
    expect(standsOut('Note 2')).toBe(false);
    await userEvent.unhover(dotOf(picture, 'Note 0') as Element);
    expect(standsOut('Note 0')).toBe(false);

    // Focused in the list, which is where the keyboard goes: the dots are not tab stops.
    const list = screen.getByRole('list');
    within(list).getAllByRole('link', { name: 'Note 7' })[0]?.focus();
    await waitFor(() => expect(standsOut('Note 7')).toBe(true));
    (document.activeElement as HTMLElement).blur();
    await waitFor(() => expect(standsOut('Note 7')).toBe(false));

    // Zoomed in until few enough notes are in view.
    for (let step = 0; step < 6; step += 1) await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(picture).toHaveClass('graph-labelled');
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(picture).not.toHaveClass('graph-labelled');
  });

  it('cuts a long title in the picture and keeps all of it in the tooltip and the list', async () => {
    const long = 'Minutes-of-the-weekly-planning-meeting-that-never-ends-'.repeat(3);
    const body = { nodes: [{ id: 'long', title: long, links: 0 }, ...nodes], edges, total: 4 };
    mockFetch({ ...lists, 'GET /api/links/graph': { body } });
    renderPage();

    const picture = await screen.findByRole('img');
    const dot = dotOf(picture, long) as Element;
    expect(dot.querySelector('text')?.textContent).toBe('Minutes-of-the-weekly-plannin…');
    expect(within(screen.getByRole('list')).getByRole('link', { name: long })).toBeInTheDocument();
  });

  it('says when the links of a note all lead to notes that are not shown, instead of "no links"', async () => {
    const body = {
      nodes: [
        { id: 'hub', title: 'Project Atlas', links: 5 },
        { id: 'plan', title: 'Atlas plan', links: 2 },
        { id: 'away', title: 'Travel', links: 3 },
        { id: 'single', title: 'Receipt', links: 1 },
        { id: 'alone', title: 'Groceries', links: 0 },
      ],
      edges,
      total: 5,
    };
    mockFetch({ ...lists, 'GET /api/links/graph': { body } });
    renderPage('/graph?tag=atlas');

    await screen.findByRole('img');
    const row = (title: string) =>
      within(screen.getByRole('list'))
        .getAllByRole('listitem')
        .find((item) => item.querySelector('.backlink-title')?.textContent === title);
    expect(row('Travel')).toHaveTextContent('Travel · 3 links, none to a note shown here');
    expect(row('Receipt')).toHaveTextContent('Receipt · 1 link, none to a note shown here');
    expect(row('Groceries')).toHaveTextContent('Groceries · no links');
    expect(row('Project Atlas')).toHaveTextContent('3 more links to notes that are not shown here');
    expect(row('Atlas plan')).not.toHaveTextContent('not shown here');
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
