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

/** Where the graph sits inside the drawing: moved by `x` and `y`, enlarged `k` times. */
export interface View extends Point {
  k: number;
}

export const NO_ZOOM: View = { x: 0, y: 0, k: 1 };
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 6;

/**
 * The space a dot keeps to itself, roughly how long a link is drawn, and how
 * hard notes push each other away. Generous, so that titles next to the dots
 * have room.
 */
const DOT_SPACE = 14;
const LINK_LENGTH = 80;
const PUSH = -220;

type Dot = SimulationNodeDatum & { id: string };

/** A small repeatable random source (mulberry32), so that a graph settles the same way every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Places the notes of a graph: linked notes pull together, all notes push
 * each other apart, and everything leans towards the middle, which is 0,0.
 * The simulation is run to its end here, so the caller gets the settled
 * picture and has nothing to animate. Edges to notes that are not in `nodes`
 * are ignored.
 */
export function layoutGraph(nodes: { id: string }[], edges: Edge[], seed = 1): Map<string, Point> {
  const dots: Dot[] = nodes.map((node) => ({ id: node.id }));
  const known = new Set(dots.map((dot) => dot.id));
  const links: SimulationLinkDatum<Dot>[] = edges
    .filter((edge) => edge.source !== edge.target && known.has(edge.source) && known.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const simulation = forceSimulation(dots)
    .randomSource(seeded(seed))
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

/** The box around all the points with some room to spare, as an SVG viewBox. Never smaller than `least`. */
export function viewBoxFor(points: Iterable<Point>, margin = 40, least = 240) {
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

/** Zooms by `factor`, keeping the spot `at` of the drawing where it is. */
export function zoomAt(view: View, at: Point, factor: number): View {
  const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * factor));
  const ratio = k / view.k;
  return { k, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio };
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
