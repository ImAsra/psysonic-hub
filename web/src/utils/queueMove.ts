import type { QueueWindow } from '../types.ts';

/**
 * The queue window after moving the track at absolute position `from` to `to` (taken out, then put
 * back so it ends up at `to`), with `index` following the current track. Shown at once, until the
 * player reports its real queue. Positions outside the window leave it unchanged.
 */
export function moveInWindow(q: QueueWindow, from: number, to: number): QueueWindow {
  const inWindow = (i: number) => i >= q.offset && i < q.offset + q.tracks.length;
  if (from === to || !inWindow(from) || !inWindow(to)) return q;

  const tracks = [...q.tracks];
  const [moved] = tracks.splice(from - q.offset, 1);
  tracks.splice(to - q.offset, 0, moved);
  return { ...q, tracks, index: followCurrent(q.index, from, to) };
}

/** Where the current track (at `cur`) is after the track at `from` moved to `to`. */
function followCurrent(cur: number, from: number, to: number): number {
  if (cur === from) return to;
  if (from < cur && to >= cur) return cur - 1;
  if (from > cur && to <= cur) return cur + 1;
  return cur;
}

/**
 * Where a track dragged from `from` ends up when dropped into the gap before position `gap`
 * (the gap after the last row is its position + 1). Below its old place it lands one earlier,
 * because taking it out moves everything after it up.
 */
export function dropTarget(from: number, gap: number): number {
  return gap > from ? gap - 1 : gap;
}
