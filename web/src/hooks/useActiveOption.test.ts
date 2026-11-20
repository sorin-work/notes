import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useActiveOption } from './useActiveOption';

const press = (key: string) => ({ key, preventDefault: vi.fn() });

describe('useActiveOption', () => {
  it('moves with the arrow keys and wraps around at both ends', () => {
    const { result } = renderHook(() => useActiveOption(3));
    expect(result.current.activeIndex).toBe(0);

    const up = press('ArrowUp');
    act(() => void result.current.onArrowKey(up));
    expect(result.current.activeIndex).toBe(2);
    expect(up.preventDefault).toHaveBeenCalled();

    act(() => void result.current.onArrowKey(press('ArrowDown')));
    expect(result.current.activeIndex).toBe(0);
    act(() => void result.current.onArrowKey(press('ArrowDown')));
    expect(result.current.activeIndex).toBe(1);
  });

  it('leaves other keys, and an empty list, alone', () => {
    const { result, rerender } = renderHook(({ count }) => useActiveOption(count), { initialProps: { count: 2 } });
    const enter = press('Enter');
    expect(result.current.onArrowKey(enter)).toBe(false);
    expect(enter.preventDefault).not.toHaveBeenCalled();

    rerender({ count: 0 });
    const down = press('ArrowDown');
    expect(result.current.onArrowKey(down)).toBe(false);
    expect(down.preventDefault).not.toHaveBeenCalled();
  });

  it('stays inside a list that got shorter', () => {
    const { result, rerender } = renderHook(({ count }) => useActiveOption(count), { initialProps: { count: 5 } });
    act(() => result.current.setActiveIndex(4));
    rerender({ count: 2 });
    expect(result.current.activeIndex).toBe(1);

    act(() => void result.current.onArrowKey(press('ArrowDown')));
    expect(result.current.activeIndex).toBe(0);
  });
});
