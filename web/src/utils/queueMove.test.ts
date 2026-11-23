import { describe, expect, it } from 'vitest';

import type { QueueWindow } from '../types.ts';
import { dropTarget, moveInWindow } from './queueMove.ts';

const win = (ids: string[], index: number, offset = 0): QueueWindow => ({
  index,
  offset,
  total: offset + ids.length,
  tracks: ids.map((id) => ({ id })),
});
const ids = (q: QueueWindow) => q.tracks.map((t) => t.id);

describe('moving a track in the queue window', () => {
  it('moves a track down and keeps the current track', () => {
    const q = moveInWindow(win(['a', 'b', 'c', 'd'], 0), 1, 3);
    expect(ids(q)).toEqual(['a', 'c', 'd', 'b']);
    expect(q.index).toBe(0);
  });

  it('follows the current track when it is the one moved', () => {
    const q = moveInWindow(win(['a', 'b', 'c'], 1), 1, 2);
    expect(ids(q)).toEqual(['a', 'c', 'b']);
    expect(q.index).toBe(2);
  });

  it('follows the current track when another one moves past it', () => {
    const q = moveInWindow(win(['a', 'b', 'c'], 1), 0, 2);
    expect(ids(q)).toEqual(['b', 'c', 'a']);
    expect(q.index).toBe(0);
  });

  it('works with absolute positions when the window starts later in the queue', () => {
    const q = moveInWindow(win(['x', 'y', 'z'], 10, 10), 12, 10);
    expect(ids(q)).toEqual(['z', 'x', 'y']);
    expect(q.index).toBe(11);
  });

  it('leaves the window alone for positions outside it', () => {
    const q = win(['a', 'b'], 0);
    expect(moveInWindow(q, 0, 5)).toBe(q);
    expect(moveInWindow(q, 1, 1)).toBe(q);
  });
});

describe('where a dragged track lands', () => {
  // gaps between rows, as absolute queue positions: dropping in gap g puts the track before row g
  it('dropping below its own row or above it keeps it in place', () => {
    expect(dropTarget(2, 2)).toBe(2);
    expect(dropTarget(2, 3)).toBe(2);
  });

  it('dropping further down lands one before the gap (the track left its old place)', () => {
    expect(dropTarget(1, 4)).toBe(3);
  });

  it('dropping further up lands at the gap', () => {
    expect(dropTarget(3, 0)).toBe(0);
  });
});
