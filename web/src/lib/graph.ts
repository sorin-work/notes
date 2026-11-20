import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

export interface Point {
  x: number;
  y: number;
}

export interface Edge {
  source: string;
  target: string;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * How the picture is looked at: enlarged `k` times and moved by `x` and `y`,
 * which are pixels of the screen counted from the middle of the picture.
 */
export interface View extends Point {
  k: number;
}

export const NO_ZOOM: View = { x: 0, y: 0, k: 1 };
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 6;

/** How fast the wheel zooms, and the most one turn of it may count for, in pixels of scrolling. */
const WHEEL_ZOOM = 0.002;
const MOST_WHEEL = 300;

/**
 * The space a dot keeps to itself, roughly how long a link is drawn, and how
 * hard notes push each other away. Generous, so that titles next to the dots
 * have room.
 */
const DOT_SPACE = 14;
const LINK_LENGTH = 80;
const PUSH = -220;

type Dot = SimulationNodeDatum & { id: string };

const inOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Places the notes of a graph: linked notes pull together, all notes push
 * each other apart, and everything leans towards the middle, which is 0,0.
 * The simulation is run to its end here, so the caller gets the settled
 * picture and has nothing to animate. Edges to notes that are not in `nodes`
 * are ignored.
 *
 * The picture depends only on which notes and links there are. Notes and
 * links are put in the order of their ids first, because the simulation
 * starts every note from a place that follows its position in the list, and
 * the list comes ordered by the last edit: saving one note would move all of
 * them. There is no seed to pick. The simulation only draws random numbers to
 * pull apart notes that land on the same spot, and it draws them from a
 * source of its own that starts the same way every time.
 */
export function layoutGraph(nodes: { id: string }[], edges: Edge[]): Map<string, Point> {
  const dots: Dot[] = nodes.map((node) => ({ id: node.id })).sort((a, b) => inOrder(a.id, b.id));
  const known = new Set(dots.map((dot) => dot.id));
  const links: SimulationLinkDatum<Dot>[] = edges
    .filter((edge) => edge.source !== edge.target && known.has(edge.source) && known.has(edge.target))
    .sort((a, b) => inOrder(a.source, b.source) || inOrder(a.target, b.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const simulation = forceSimulation(dots)
    .force(
      'link',
      forceLink<Dot, SimulationLinkDatum<Dot>>(links)
        .id((dot) => dot.id)
        .distance(LINK_LENGTH),
    )
    .force('charge', forceManyBody().strength(PUSH))
    .force('x', forceX().strength(0.07))
    .force('y', forceY().strength(0.07))
    .force('collide', forceCollide(DOT_SPACE))
    .stop();
  // As many steps as the simulation would take on its own before it comes to rest.
  simulation.tick(Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())));

  const round = (value = 0) => Math.round(value * 10) / 10;
  return new Map(dots.map((dot) => [dot.id, { x: round(dot.x), y: round(dot.y) }]));
}

/** The box around all the points with some room to spare, in the units of the layout. Never smaller than `least`. */
export function boxAround(points: Iterable<Point>, margin = 20, least = 240) {
  let [left, top, right, bottom] = [0, 0, 0, 0];
  for (const { x, y } of points) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const width = Math.max(right - left + 2 * margin, least);
  const height = Math.max(bottom - top + 2 * margin, least);
  return { x: (left + right - width) / 2, y: (top + bottom - height) / 2, width, height };
}

/**
 * How many pixels one unit of the layout gets so that the whole box fits
 * into a picture of `size`, with `padding` pixels kept free on every side.
 */
export function fitScale(box: Size, size: Size, padding = 0): number {
  const room = (pixels: number) => Math.max(pixels - 2 * padding, 1);
  return Math.min(room(size.width) / box.width, room(size.height) / box.height);
}

/**
 * Zooms by `factor`, keeping the spot `at` of the picture where it is. `at`
 * is counted in pixels from the middle of the picture, like the view.
 */
export function zoomAt(view: View, at: Point, factor: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
  const ratio = k / view.k;
  return { k, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
}

/**
 * How much one event of the wheel zooms: in proportion to how far it turned,
 * in for a turn away from the user and out for a turn towards them. No turn
 * is no zoom, and one event never counts for more than a few notches, so a
 * hard swipe does not jump to the limit. `mode` is the event's `deltaMode`:
 * pixels, lines or pages.
 */
export function wheelFactor(deltaY: number, mode = 0): number {
  const pixels = deltaY * (mode === 1 ? 16 : mode === 2 ? 400 : 1);
  return Math.exp(-Math.max(-MOST_WHEEL, Math.min(MOST_WHEEL, pixels)) * WHEEL_ZOOM);
}

/** A title cut to `most` characters for the picture. The whole title stays in the tooltip and in the list. */
export function shortTitle(title: string, most = 30): string {
  const letters = Array.from(title);
  if (letters.length <= most) return title;
  return `${letters
    .slice(0, most - 1)
    .join('')
    .trimEnd()}…`;
}

/** The id of the note that an element of the picture or the list stands for, if it stands for one. */
export function noteAt(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest('[data-note]')?.getAttribute('data-note') ?? null) : null;
}

/** For each note, the notes it links to and the notes that link to it. */
export function neighbours(edges: Edge[]): Map<string, { out: string[]; in: string[] }> {
  const result = new Map<string, { out: string[]; in: string[] }>();
  const of = (id: string) => {
    if (!result.has(id)) result.set(id, { out: [], in: [] });
    return result.get(id) as { out: string[]; in: string[] };
  };
  for (const { source, target } of edges) {
    of(source).out.push(target);
    of(target).in.push(source);
  }
  return result;
}
