import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Graph } from '../api/types';
import { useGraphLayout } from './useGraphLayout';

const graph = (): Graph => ({
  nodes: [
    { id: 'a', title: 'A', links: 1 },
    { id: 'b', title: 'B', links: 1 },
  ],
  edges: [{ source: 'a', target: 'b' }],
  total: 2,
});

describe('useGraphLayout', () => {
  it('lays a graph out once, and hands the same picture to whoever asks for that graph again', async () => {
    const first = graph();
    const { result, rerender } = renderHook(({ shown }) => useGraphLayout(shown), { initialProps: { shown: first } });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    const placed = result.current;
    expect([...(placed?.keys() ?? [])]).toEqual(['a', 'b']);

    // Another answer from the server, as after a change of filter: laid out afresh.
    const second = { ...graph(), nodes: [...graph().nodes, { id: 'c', title: 'C', links: 0 }] };
    rerender({ shown: second });
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current?.size).toBe(3));

    // Back to the first: nothing to wait for, and the very same picture.
    rerender({ shown: first });
    expect(result.current).toBe(placed);
    expect(renderHook(() => useGraphLayout(first)).result.current).toBe(placed);
  });
});
