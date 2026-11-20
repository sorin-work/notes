import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStoredSet } from './useStoredSet';

describe('useStoredSet', () => {
  it('puts ids in and takes them out, and remembers them', () => {
    const { result } = renderHook(() => useStoredSet('test.closed'));
    expect([...result.current[0]]).toEqual([]);

    act(() => result.current[1]('a'));
    act(() => result.current[1]('b'));
    act(() => result.current[1]('a'));
    expect([...result.current[0]]).toEqual(['b']);
    expect(localStorage.getItem('test.closed')).toBe('["b"]');

    const again = renderHook(() => useStoredSet('test.closed'));
    expect(again.result.current[0].has('b')).toBe(true);
  });

  it('starts empty when what is stored is not a list of ids', () => {
    localStorage.setItem('test.closed', '{"a":1}');
    expect(renderHook(() => useStoredSet('test.closed')).result.current[0].size).toBe(0);
    localStorage.setItem('test.closed', 'not json');
    expect(renderHook(() => useStoredSet('test.closed')).result.current[0].size).toBe(0);
    localStorage.setItem('test.closed', '["a", 2, null]');
    expect([...renderHook(() => useStoredSet('test.closed')).result.current[0]]).toEqual(['a']);
  });
});
