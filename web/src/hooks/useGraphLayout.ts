import { useEffect, useState } from 'react';
import type { Graph } from '../api/types';
import { layoutGraph, type Point } from '../lib/graph';

/**
 * The layouts that have been worked out, by the graph they belong to. The
 * query cache hands out the same object for the same answer, so going back
 * to a filter that was looked at before finds its picture here.
 */
const layouts = new WeakMap<Graph, Map<string, Point>>();

/**
 * Where the notes of a graph go, or null while that is being worked out.
 *
 * Laying out a few hundred notes takes a few hundred milliseconds. It is
 * done after the page has been drawn without the picture, not while
 * rendering, so the filters, the counts and the list are there first and
 * the picture can say that it is on its way.
 */
export function useGraphLayout(graph: Graph): Map<string, Point> | null {
  const [, setLaidOut] = useState<Graph | null>(null);

  useEffect(() => {
    if (layouts.has(graph)) return;
    let started = false;
    const work = () => {
      if (started) return;
      started = true;
      layouts.set(graph, layoutGraph(graph.nodes, graph.edges));
      setLaidOut(graph);
    };
    let afterDrawing: ReturnType<typeof setTimeout> | undefined;
    // The frame callback runs just before the browser draws, and a timer set in it runs after it has drawn.
    const frame = requestAnimationFrame(() => {
      afterDrawing = setTimeout(work, 0);
    });
    // A tab in the background gets no frames. The picture does not wait for one for long.
    const anyway = setTimeout(work, 250);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(afterDrawing);
      clearTimeout(anyway);
    };
  }, [graph]);

  return layouts.get(graph) ?? null;
}
