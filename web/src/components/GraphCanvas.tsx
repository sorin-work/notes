import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Graph } from '../api/types';
import { layoutGraph, neighbours, NO_ZOOM, type Point, type View, viewBoxFor, zoomAt } from '../lib/graph';

/** With more notes than this, titles are only shown for the note under the pointer, or after zooming in. */
const ALWAYS_LABELLED = 40;
const LABEL_ZOOM = 1.6;

interface Props {
  graph: Graph;
  onOpen(noteId: string): void;
}

/**
 * The picture: a dot for every note and a line for every link, laid out
 * once and drawn settled, so there is no motion to switch off. It can be
 * dragged and zoomed, and a click on a dot opens the note. To a screen
 * reader it is one image. The list on the page says the same in words.
 */
export function GraphCanvas({ graph, onOpen }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(NO_ZOOM);
  const [hovered, setHovered] = useState<string | null>(null);
  const drag = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const placed = useMemo(() => layoutGraph(graph.nodes, graph.edges), [graph]);
  const box = useMemo(() => viewBoxFor(placed.values()), [placed]);
  const linked = useMemo(() => neighbours(graph.edges), [graph.edges]);
  const centre: Point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const near = new Set<string>();
  if (hovered) {
    near.add(hovered);
    for (const id of [...(linked.get(hovered)?.out ?? []), ...(linked.get(hovered)?.in ?? [])]) near.add(id);
  }

  /** How many units of the drawing one pixel of the screen is. */
  const unitsPerPixel = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? Math.max(box.width / rect.width, box.height / rect.height) : 1;
  };

  // React listens to the wheel passively, and the page must not scroll while the graph zooms.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const matrix = svg.getScreenCTM?.();
      const at = matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
      setView((current) => zoomAt(current, at ?? { x: 0, y: 0 }, event.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
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
    const scale = unitsPerPixel();
    drag.current = { pointer: from.pointer, x: event.clientX, y: event.clientY };
    setView((current) => ({ ...current, x: current.x + dx * scale, y: current.y + dy * scale }));
  };
  const endDrag = () => {
    drag.current = null;
    // The click that ends a drag comes after this. It must not open a note.
    setTimeout(() => setDragging(false), 0);
  };

  const labelled = graph.nodes.length <= ALWAYS_LABELLED || view.k >= LABEL_ZOOM;
  const classes = ['graph', labelled && 'graph-labelled', hovered && 'graph-dimmed', dragging && 'graph-dragging'];

  return (
    <div className="graph-canvas">
      <div className="graph-tools" role="group" aria-label="Zoom">
        <button
          type="button"
          className="button"
          aria-label="Zoom in"
          onClick={() => setView(zoomAt(view, centre, 1.4))}
        >
          +
        </button>
        <button
          type="button"
          className="button"
          aria-label="Zoom out"
          onClick={() => setView(zoomAt(view, centre, 1 / 1.4))}
        >
          −
        </button>
        <button type="button" className="button" onClick={() => setView(NO_ZOOM)}>
          Reset
        </button>
      </div>
      <svg
        ref={svgRef}
        className={classes.filter(Boolean).join(' ')}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        role="img"
        aria-label={`Graph of ${graph.nodes.length} notes and ${graph.edges.length} links. The list below has the same notes and links.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map((edge) => {
            const [from, to] = [placed.get(edge.source), placed.get(edge.target)];
            if (!from || !to) return null;
            const lit = hovered === edge.source || hovered === edge.target;
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
          {graph.nodes.map((node) => {
            const at = placed.get(node.id);
            if (!at) return null;
            const links = (linked.get(node.id)?.out.length ?? 0) + (linked.get(node.id)?.in.length ?? 0);
            const radius = 4 + Math.min(6, Math.sqrt(links) * 1.6);
            return (
              <g
                key={node.id}
                className={near.has(node.id) ? 'graph-node near' : 'graph-node'}
                transform={`translate(${at.x} ${at.y})`}
                onPointerEnter={() => setHovered(node.id)}
                onPointerLeave={() => setHovered(null)}
                onClick={() => !dragging && onOpen(node.id)}
              >
                <title>{node.title}</title>
                <circle r={radius} />
                <text x={radius + 4} y={4}>
                  {node.title}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
