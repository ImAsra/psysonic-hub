import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useThrottled } from './useThrottled.ts';

describe('useThrottled', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a fast drag sends at most one value per interval, and always the latest one', () => {
    const sent: number[] = [];
    const { result } = renderHook(() => useThrottled((v: number) => sent.push(v), 100));

    act(() => {
      for (const v of [0.1, 0.2, 0.3, 0.4]) result.current.push(v);
    });

    expect(sent).toEqual([]);
    act(() => void vi.advanceTimersByTime(0));
    expect(sent).toEqual([0.4]);

    act(() => {
      result.current.push(0.5);
      result.current.push(0.6);
    });

    act(() => void vi.advanceTimersByTime(50));
    expect(sent).toEqual([0.4]);
    act(() => void vi.advanceTimersByTime(50));
    expect(sent).toEqual([0.4, 0.6]);
  });

  it('releasing the slider sends the final value right away, without a late duplicate', () => {
    const sent: number[] = [];
    const { result } = renderHook(() => useThrottled((v: number) => sent.push(v), 100));

    act(() => {
      result.current.push(0.2);
      result.current.flush(0.7);
    });

    expect(sent).toEqual([0.7]);
    act(() => void vi.advanceTimersByTime(500));
    expect(sent).toEqual([0.7]);
  });
});
