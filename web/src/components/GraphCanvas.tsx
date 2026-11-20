import { memo, type PointerEvent, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { Graph } from '../api/types';
import { useGraphLayout } from '../hooks/useGraphLayout';
import {
  boxAround,
  fitScale,
  neighbours,
  NO_ZOOM,
  noteAt,
  type Point,
  shortTitle,
  type Size,
  type View,
  wheelFactor,
  zoomAt,
} from '../lib/graph';

/** Titles are drawn next to every dot while no more notes than this are in view. With more, only for the note pointed at. */
const LABELLED_IN_VIEW = 40;
/**
 * Sizes in pixels of the screen, at every zoom and for every number of
 * notes: zooming moves the dots apart, it does not blow them up. A dot is
 * never smaller than DOT_RADIUS, and it can be clicked anywhere within
 * HIT_RADIUS of its middle. A note with many links gets up to DOT_EXTRA
 * more, less of it while the picture is crowded.
 */
const DOT_RADIUS = 4;
const DOT_EXTRA = 6;
const HIT_RADIUS = 12;
const PADDING = 28;
/** Used until the picture has been measured, and where it cannot be. */
const ASSUMED_SIZE: Size = { width: 800, height: 480 };

const MIDDLE: Point = { x: 0, y: 0 };

interface Props {
  graph: Graph;
  /** The note that is pointed at, here or in the list. It and the notes it is linked with stand out. */
  active: string | null;
  onActive(noteId: string | null): void;
  onOpen(noteId: string): void;
}

function useSize(ref: RefObject<Element | null>): Size {
  const [size, setSize] = useState(ASSUMED_SIZE);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry?.contentRect ?? { width: 0, height: 0 };
      if (width > 0 && height > 0) setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * The picture: a dot for every note and a line for every link, laid out
 * once and drawn settled, so there is no motion to switch off. It can be
 * dragged and zoomed, and a click on a dot opens the note. To a screen
 * reader it is one image. The list on the page says the same in words.
 */
export function GraphCanvas({ graph, active, onActive, onOpen }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const size = useSize(frameRef);
  const placed = useGraphLayout(graph);
  const [view, setView] = useState<View>(NO_ZOOM);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const linked = useMemo(() => neighbours(graph.edges), [graph.edges]);
  const box = useMemo(() => boxAround(placed?.values() ?? []), [placed]);
  // Pixels for one unit of the layout: what makes everything fit, times the zoom.
  const scale = fitScale(box, size, PADDING) * view.k;
  const dots = useMemo(() => {
    const [midX, midY] = [box.x + box.width / 2, box.y + box.height / 2];
    const round = (value: number) => Math.round(value * 10) / 10;
    const at = new Map<string, Point>();
    for (const [id, point] of placed ?? []) {
      at.set(id, {
        x: round(size.width / 2 + (point.x - midX) * scale),
        y: round(size.height / 2 + (point.y - midY) * scale),
      });
    }
    return at;
  }, [placed, box, size, scale]);

  let inView = 0;
  for (const { x, y } of dots.values()) {
    const [left, top] = [x + view.x, y + view.y];
    if (left >= 0 && left <= size.width && top >= 0 && top <= size.height) inView += 1;
  }
  const labelled = inView <= LABELLED_IN_VIEW;

  // React listens to the wheel passively, and a zoom must be able to keep the page from zooming with it.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      // A plain turn of the wheel scrolls the page, over the picture as anywhere else. With Ctrl or Cmd held it
      // zooms, which is also how the pinch of a trackpad arrives.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = frame.getBoundingClientRect();
      const at = { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
      setView((current) => zoomAt(current, at, wheelFactor(event.deltaY, event.deltaMode)));
    };
    frame.addEventListener('wheel', onWheel, { passive: false });
    return () => frame.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const from = drag.current;
    if (!from || from.pointer !== event.pointerId) return;
    const [dx, dy] = [event.clientX - from.x, event.clientY - from.y];
    // A few pixels of wobble during a click are not a drag.
    if (!dragging && Math.hypot(dx, dy) < 4) return;
    if (!dragging) {
      setDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    drag.current = { pointer: from.pointer, x: event.clientX, y: event.clientY };
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };
  const endDrag = () => {
    drag.current = null;
    // The click that ends a drag comes after this. It must not open a note.
    setTimeout(() => setDragging(false), 0);
  };

  // One unit of the layout is a pixel or more when there is room. Below that the dots are close to each other.
  const crowding = Math.min(1, Math.max(0.3, Math.round(scale * 10) / 10));

  const classes = ['graph', labelled && 'graph-labelled', active && 'graph-dimmed', dragging && 'graph-dragging'];

  return (
    <div className="graph-canvas">
      <div className="graph-tools">
        <div className="graph-zoom" role="group" aria-label="Zoom">
          <button
            type="button"
            className="button"
            aria-label="Zoom in"
            onClick={() => setView((current) => zoomAt(current, MIDDLE, 1.4))}
          >
            +
          </button>
          <button
            type="button"
            className="button"
            aria-label="Zoom out"
            onClick={() => setView((current) => zoomAt(current, MIDDLE, 1 / 1.4))}
          >
            −
          </button>
          <button type="button" className="button" onClick={() => setView(NO_ZOOM)}>
            Reset
          </button>
          <output className="muted" aria-label="Zoom level">
            {Math.round(view.k * 100)}%
          </output>
        </div>
        <p className="muted graph-hint">Drag to move. Hold Ctrl or Cmd and turn the wheel to zoom.</p>
      </div>
      <div className="graph-frame" ref={frameRef}>
        {placed ? (
          <svg
            className={classes.filter(Boolean).join(' ')}
            role="img"
            aria-label={`Graph of ${graph.nodes.length} notes and ${graph.edges.length} links. The list below has the same notes and links.`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerOver={(event) => onActive(noteAt(event.target))}
            onPointerLeave={() => onActive(null)}
            onClick={(event) => {
              const id = noteAt(event.target);
              if (id && !dragging) onOpen(id);
            }}
          >
            {/* Moving the picture changes this one attribute and leaves the drawing as it is. */}
            <g transform={`translate(${Math.round(view.x * 10) / 10} ${Math.round(view.y * 10) / 10})`}>
              <Drawing graph={graph} dots={dots} linked={linked} active={active} crowding={crowding} />
            </g>
          </svg>
        ) : (
          <p className="graph-wait muted" role="status">
            Laying out the picture…
          </p>
        )}
      </div>
    </div>
  );
}

interface DrawingProps {
  graph: Graph;
  /** Where each note is drawn, in pixels. */
  dots: Map<string, Point>;
  linked: ReturnType<typeof neighbours>;
  active: string | null;
  /** From 0.3 for a crowded picture to 1 for one with room: how much of the extra size the dots get. */
  crowding: number;
}

const Drawing = memo(function Drawing({ graph, dots, linked, active, crowding }: DrawingProps) {
  const near = new Set<string>();
  if (active) {
    near.add(active);
    for (const id of [...(linked.get(active)?.out ?? []), ...(linked.get(active)?.in ?? [])]) near.add(id);
  }

  return (
    <>
      {graph.edges.map((edge) => {
        const [from, to] = [dots.get(edge.source), dots.get(edge.target)];
        if (!from || !to) return null;
        const lit = active === edge.source || active === edge.target;
        return (
          <line
            key={`${edge.source} ${edge.target}`}
            className={lit ? 'graph-edge near' : 'graph-edge'}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
          />
        );
      })}
      {/* The room around every dot that counts as the dot. Under all the dots, so that it never covers another one. */}
      {graph.nodes.map((node) => {
        const at = dots.get(node.id);
        return (
          at && <circle key={node.id} className="graph-hit" data-note={node.id} cx={at.x} cy={at.y} r={HIT_RADIUS} />
        );
      })}
      {graph.nodes.map((node) => {
        const at = dots.get(node.id);
        if (!at) return null;
        const links = (linked.get(node.id)?.out.length ?? 0) + (linked.get(node.id)?.in.length ?? 0);
        const radius = Math.round((DOT_RADIUS + Math.min(DOT_EXTRA, Math.sqrt(links) * 1.6) * crowding) * 10) / 10;
        return (
          <g
            key={node.id}
            className={near.has(node.id) ? 'graph-node near' : 'graph-node'}
            data-note={node.id}
            transform={`translate(${at.x} ${at.y})`}
          >
            <title>{node.title}</title>
            <circle r={radius} />
            <text x={radius + 4} y={4}>
              {shortTitle(node.title)}
            </text>
          </g>
        );
      })}
    </>
  );
});
