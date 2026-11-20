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

  describe('with a conflict', () => {
    const stale = new Error('changed elsewhere');
    const conflicts = () => ({
      isConflict: (error: unknown) => error === stale,
      onConflict: vi.fn(),
      saveOver: vi.fn().mockResolvedValue(undefined),
    });

    it('keeps the value and does not send it again until told to', async () => {
      const save = vi.fn().mockRejectedValueOnce(stale).mockResolvedValue(undefined);
      const handling = conflicts();
      const { result } = renderHook(() => useAutosave(save, 500, handling));
      act(() => result.current.schedule('mine'));
      await act(() => vi.advanceTimersByTimeAsync(500));

      expect(result.current.status).toBe('conflict');
      expect(result.current.conflict).toBe(stale);
      expect(handling.onConflict).toHaveBeenCalledWith(stale);

      // Neither a flush nor more typing sends anything, but the newest text is the one that is kept.
      await act(() => result.current.flush());
      act(() => result.current.schedule('mine, and more'));
      await act(() => vi.advanceTimersByTimeAsync(5000));
      expect(save).toHaveBeenCalledTimes(1);
      expect(result.current.status).toBe('conflict');
      expect(result.current.hasPending()).toBe(true);

      await act(() => result.current.retry());
      expect(save).toHaveBeenLastCalledWith('mine, and more');
      expect(result.current.status).toBe('saved');
      expect(result.current.conflict).toBeNull();
      expect(result.current.hasPending()).toBe(false);
    });

    it('drops the value on discard', async () => {
      const save = vi.fn().mockRejectedValue(stale);
      const { result } = renderHook(() => useAutosave(save, 500, conflicts()));
      act(() => result.current.schedule('mine'));
      await act(() => result.current.flush());
      act(() => result.current.discard());

      expect(result.current.status).toBe('saved');
      expect(result.current.hasPending()).toBe(false);
      await act(() => result.current.flush());
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('saves over a conflict that is still open when it unmounts', async () => {
      const save = vi.fn().mockRejectedValue(stale);
      const handling = conflicts();
      const { result, unmount } = renderHook(() => useAutosave(save, 500, handling));
      act(() => result.current.schedule('mine'));
      await act(() => result.current.flush());
      act(() => result.current.schedule('mine, typed after closing the question'));

      unmount();
      await vi.runAllTimersAsync();
      expect(handling.saveOver).toHaveBeenCalledWith('mine, typed after closing the question', stale);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it('does the same when the conflict only shows up in the save made on unmounting', async () => {
      const save = vi.fn().mockRejectedValue(stale);
      const handling = conflicts();
      const { result, unmount } = renderHook(() => useAutosave(save, 500, handling));
      act(() => result.current.schedule('last words'));
      unmount();
      await vi.runAllTimersAsync();
      expect(save).toHaveBeenCalledWith('last words');
      expect(handling.saveOver).toHaveBeenCalledWith('last words', stale);
      expect(handling.onConflict).not.toHaveBeenCalled();
    });
  });

  describe('when the component goes away with something unsaved', () => {
    const farewell = () => ({ keep: vi.fn(), saved: vi.fn(), failed: vi.fn() });

    it('puts the value aside before the last save, and says so when that worked', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const handling = farewell();
      const { result, unmount } = renderHook(() => useAutosave(save, 500, undefined, handling));
      act(() => result.current.schedule('last words'));

      unmount();
      // Kept at once, while the save is still on its way.
      expect(handling.keep).toHaveBeenCalledWith('last words');
      expect(handling.saved).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(save).toHaveBeenCalledWith('last words');
      expect(handling.saved).toHaveBeenCalledTimes(1);
      expect(handling.failed).not.toHaveBeenCalled();
    });

    it('says that the save failed, so that what was put aside is all there is', async () => {
      const save = vi.fn().mockRejectedValue(new Error('offline'));
      const handling = farewell();
      const { result, unmount } = renderHook(() => useAutosave(save, 500, undefined, handling));
      act(() => result.current.schedule('last words'));
      unmount();
      await vi.runAllTimersAsync();
      expect(handling.keep).toHaveBeenCalledWith('last words');
      expect(handling.failed).toHaveBeenCalledTimes(1);
      expect(handling.saved).not.toHaveBeenCalled();
    });

    it('does nothing of the sort when everything was saved', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const handling = farewell();
      const { result, unmount } = renderHook(() => useAutosave(save, 500, undefined, handling));
      act(() => result.current.schedule('saved in time'));
      await act(() => result.current.flush());
      unmount();
      await vi.runAllTimersAsync();
      expect(handling.keep).not.toHaveBeenCalled();
      expect(handling.saved).not.toHaveBeenCalled();
      expect(handling.failed).not.toHaveBeenCalled();
    });
  });
});
