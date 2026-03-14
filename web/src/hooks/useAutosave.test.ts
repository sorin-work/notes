import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves the latest value once typing stops', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, 500));

    act(() => {
      result.current.schedule('a');
      result.current.schedule('ab');
    });
    expect(result.current.status).toBe('pending');
    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('ab');
    expect(result.current.status).toBe('saved');
  });

  it('saves straight away on flush', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, 500));
    act(() => result.current.schedule('now'));
    await act(() => result.current.flush());
    expect(save).toHaveBeenCalledWith('now');
  });

  it('saves pending changes when unmounted', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => useAutosave(save, 500));
    act(() => result.current.schedule('last words'));
    unmount();
    await vi.runAllTimersAsync();
    expect(save).toHaveBeenCalledWith('last words');
  });

  it('reports errors and retries on the next flush', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(save, 500));
    act(() => result.current.schedule('x'));
    await act(() => result.current.flush());
    expect(result.current.status).toBe('error');
    expect(result.current.hasPending()).toBe(true);

    await act(() => result.current.flush());
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
  });
});
