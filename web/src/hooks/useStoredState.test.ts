import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStoredState } from './useStoredState';

const MODES = ['edit', 'split', 'preview'] as const;

describe('useStoredState', () => {
  it('remembers the chosen value', () => {
    const { result } = renderHook(() => useStoredState('test.mode', MODES, 'split'));
    act(() => result.current[1]('preview'));
    expect(result.current[0]).toBe('preview');
    expect(localStorage.getItem('test.mode')).toBe('preview');

    const again = renderHook(() => useStoredState('test.mode', MODES, 'split'));
    expect(again.result.current[0]).toBe('preview');
  });

  it('ignores stored values that are not allowed', () => {
    localStorage.setItem('test.mode', 'fullscreen');
    const { result } = renderHook(() => useStoredState('test.mode', MODES, 'split'));
    expect(result.current[0]).toBe('split');
  });
});
