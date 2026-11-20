import { describe, expect, it } from 'vitest';
import { layoutGraph, neighbours, NO_ZOOM, viewBoxFor, zoomAt } from './graph';

const ids = (...names: string[]) => names.map((id) => ({ id }));
const distance = (a?: { x: number; y: number }, b?: { x: number; y: number }) =>
  Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));

describe('layoutGraph', () => {
  const nodes = ids('hub', 'a', 'b', 'c', 'far', 'alone');
  const edges = [
    { source: 'hub', target: 'a' },
    { source: 'hub', target: 'b' },
    { source: 'c', target: 'hub' },
  ];

  it('settles the same graph the same way every time for a seed', () => {
    const first = layoutGraph(nodes, edges, 7);
    expect([...layoutGraph(nodes, edges, 7)]).toEqual([...first]);
    expect(first.size).toBe(6);
    for (const point of first.values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });

  it('pulls linked notes together and keeps every note apart from the others', () => {
    const placed = layoutGraph(nodes, edges, 7);
    const hub = placed.get('hub');
    const linked = ['a', 'b', 'c'].map((id) => distance(hub, placed.get(id)));
    const unlinked = ['far', 'alone'].map((id) => distance(hub, placed.get(id)));
    expect(Math.max(...linked)).toBeLessThan(Math.min(...unlinked));

    const points = [...placed.values()];
    for (const [index, point] of points.entries()) {
      for (const other of points.slice(index + 1)) expect(distance(point, other)).toBeGreaterThan(15);
    }
  });

  it('leaves out edges to notes that are not in the graph, and loops', () => {
    const edgesOutside = [...edges, { source: 'hub', target: 'missing' }, { source: 'a', target: 'a' }];
    expect([...layoutGraph(nodes, edgesOutside, 7)]).toEqual([...layoutGraph(nodes, edges, 7)]);
    expect(layoutGraph([], [], 7).size).toBe(0);
  });

  it('places three hundred notes around the middle', () => {
    const many = ids(...Array.from({ length: 300 }, (_, i) => `n${i}`));
    const chain = many.slice(1).map((node, i) => ({ source: `n${i}`, target: node.id }));
    const placed = layoutGraph(many, chain);
    const box = viewBoxFor(placed.values());
    expect(placed.size).toBe(300);
    expect(Math.abs(box.x + box.width / 2)).toBeLessThan(box.width / 4);
    expect(Math.abs(box.y + box.height / 2)).toBeLessThan(box.height / 4);
  });
});

describe('viewBoxFor', () => {
  it('surrounds the points with a margin and has a least size', () => {
    expect(
      viewBoxFor(
        [
          { x: -100, y: -50 },
          { x: 300, y: 150 },
        ],
        20,
      ),
    ).toEqual({ x: -120, y: -70, width: 440, height: 240 });
    expect(viewBoxFor([], 20, 200)).toEqual({ x: -100, y: -100, width: 200, height: 200 });
  });
});

describe('zoomAt', () => {
  it('keeps the spot under the pointer where it is', () => {
    const zoomed = zoomAt(NO_ZOOM, { x: 100, y: 50 }, 2);
    expect(zoomed).toEqual({ k: 2, x: -100, y: -50 });
    // The world point that was drawn at 100,50 is still drawn there.
    expect({ x: zoomed.k * 100 + zoomed.x, y: zoomed.k * 50 + zoomed.y }).toEqual({ x: 100, y: 50 });
  });

  it('stops at the smallest and the largest zoom', () => {
    expect(zoomAt(NO_ZOOM, { x: 0, y: 0 }, 100).k).toBe(6);
    expect(zoomAt(NO_ZOOM, { x: 0, y: 0 }, 0.001).k).toBe(0.3);
  });
});

describe('neighbours', () => {
  it('lists links out and links in for every note that has any', () => {
    const map = neighbours([
      { source: 'a', target: 'b' },
      { source: 'c', target: 'b' },
    ]);
    expect(map.get('b')).toEqual({ out: [], in: ['a', 'c'] });
    expect(map.get('a')).toEqual({ out: ['b'], in: [] });
    expect(map.has('d')).toBe(false);
  });
});
