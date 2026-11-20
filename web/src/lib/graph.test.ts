import { describe, expect, it } from 'vitest';
import {
  boxAround,
  fitScale,
  layoutGraph,
  neighbours,
  NO_ZOOM,
  noteAt,
  shortTitle,
  wheelFactor,
  zoomAt,
} from './graph';

const ids = (...names: string[]) => names.map((id) => ({ id }));
const distance = (a?: { x: number; y: number }, b?: { x: number; y: number }) =>
  Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
const sorted = (placed: Map<string, unknown>) => [...placed].sort(([a], [b]) => a.localeCompare(b));

describe('layoutGraph', () => {
  const nodes = ids('hub', 'a', 'b', 'c', 'far', 'alone');
  const edges = [
    { source: 'hub', target: 'a' },
    { source: 'hub', target: 'b' },
    { source: 'c', target: 'hub' },
  ];

  it('settles the same notes and links the same way, in whatever order they come', () => {
    const first = layoutGraph(nodes, edges);
    expect(first.size).toBe(6);
    for (const point of first.values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
    // The server lists notes by their last edit, so a save moves a note to the front of the list.
    const afterASave = [nodes[4], ...nodes.slice(0, 4), nodes[5]] as typeof nodes;
    expect(sorted(layoutGraph(afterASave, [...edges].reverse()))).toEqual(sorted(first));
  });

  it('gives another picture for other links, so the order of ids is not all there is to it', () => {
    const other = layoutGraph(nodes, [{ source: 'far', target: 'alone' }]);
    expect(sorted(other)).not.toEqual(sorted(layoutGraph(nodes, edges)));
  });

  it('pulls linked notes together and keeps every note apart from the others', () => {
    const placed = layoutGraph(nodes, edges);
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
    expect([...layoutGraph(nodes, edgesOutside)]).toEqual([...layoutGraph(nodes, edges)]);
    expect(layoutGraph([], []).size).toBe(0);
  });

  it('places three hundred notes around the middle', () => {
    const many = ids(...Array.from({ length: 300 }, (_, i) => `n${i}`));
    const chain = many.slice(1).map((node, i) => ({ source: `n${i}`, target: node.id }));
    const placed = layoutGraph(many, chain);
    const box = boxAround(placed.values());
    expect(placed.size).toBe(300);
    expect(Math.abs(box.x + box.width / 2)).toBeLessThan(box.width / 4);
    expect(Math.abs(box.y + box.height / 2)).toBeLessThan(box.height / 4);
  });
});

describe('boxAround', () => {
  it('surrounds the points with a margin and has a least size', () => {
    expect(
      boxAround(
        [
          { x: -100, y: -50 },
          { x: 300, y: 150 },
        ],
        20,
      ),
    ).toEqual({ x: -120, y: -70, width: 440, height: 240 });
    expect(boxAround([], 20, 200)).toEqual({ x: -100, y: -100, width: 200, height: 200 });
  });
});

describe('fitScale', () => {
  it('gives the pixels for one unit that make the whole box fit, with room kept free at the sides', () => {
    expect(fitScale({ width: 400, height: 100 }, { width: 800, height: 480 })).toBe(2);
    expect(fitScale({ width: 400, height: 400 }, { width: 800, height: 480 })).toBe(1.2);
    expect(fitScale({ width: 400, height: 400 }, { width: 800, height: 480 }, 40)).toBe(1);
    // A picture that has no size yet does not turn the drawing inside out.
    expect(fitScale({ width: 400, height: 400 }, { width: 0, height: 0 }, 40)).toBeGreaterThan(0);
  });
});

describe('zoomAt', () => {
  it('keeps the spot under the pointer where it is', () => {
    const zoomed = zoomAt(NO_ZOOM, { x: 100, y: 50 }, 2);
    expect(zoomed).toEqual({ k: 2, x: -100, y: -50 });
    // What was drawn at 100,50 is still drawn there.
    expect({ x: zoomed.k * 100 + zoomed.x, y: zoomed.k * 50 + zoomed.y }).toEqual({ x: 100, y: 50 });
  });

  it('stops at the smallest and the largest zoom', () => {
    expect(zoomAt(NO_ZOOM, { x: 0, y: 0 }, 100).k).toBe(6);
    expect(zoomAt(NO_ZOOM, { x: 0, y: 0 }, 0.001).k).toBe(0.3);
  });
});

describe('wheelFactor', () => {
  it('zooms in proportion to how far the wheel turned, and not at all for no turn', () => {
    expect(wheelFactor(0)).toBe(1);
    expect(wheelFactor(-100)).toBeCloseTo(1.2214, 3);
    expect(wheelFactor(100)).toBeCloseTo(1 / 1.2214, 3);
    // The small steps of a pinch add up to the same as one large step.
    expect(wheelFactor(-4) ** 25).toBeCloseTo(wheelFactor(-100), 6);
    expect(wheelFactor(-2)).toBeLessThan(1.005);
  });

  it('counts lines and pages as the pixels they scroll, and caps one event', () => {
    expect(wheelFactor(-3, 1)).toBeCloseTo(wheelFactor(-48), 6);
    expect(wheelFactor(-10_000)).toBe(wheelFactor(-300));
    expect(wheelFactor(1, 2)).toBe(wheelFactor(300));
    // Far from the limits of the zoom: a hard swipe is one step, not the end of the scale.
    expect(wheelFactor(-10_000)).toBeLessThan(2);
  });
});

describe('shortTitle', () => {
  it('cuts a long title and leaves a short one alone', () => {
    expect(shortTitle('Groceries')).toBe('Groceries');
    expect(shortTitle('a'.repeat(30))).toBe('a'.repeat(30));
    expect(shortTitle('a'.repeat(31))).toBe(`${'a'.repeat(29)}…`);
    expect(shortTitle('Minutes of the weekly planning meeting', 12)).toBe('Minutes of…');
    // Cut between characters, not inside one.
    expect(shortTitle('😀'.repeat(5), 3)).toBe('😀😀…');
  });
});

describe('noteAt', () => {
  it('finds the note an element belongs to', () => {
    document.body.innerHTML = '<ul><li data-note="n1"><a href="#">Title</a></li><li><a href="#">Other</a></li></ul>';
    const [inside, outside] = [...document.querySelectorAll('a')];
    expect(noteAt(inside ?? null)).toBe('n1');
    expect(noteAt(outside ?? null)).toBeNull();
    expect(noteAt(null)).toBeNull();
    document.body.innerHTML = '';
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
