import type { QueueTrack, QueueWindow } from '../types.ts';

export interface QueueRow {
  track: QueueTrack;
  /** Absolute position in the player's queue. */
  index: number;
  place: 'played' | 'current' | 'upcoming';
}

/** The rows of a queue window, each with its absolute position and whether it was played. */
export function queueRows(q: QueueWindow): QueueRow[] {
  return q.tracks.map((track, i) => {
    const index = q.offset + i;
    const place = index === q.index ? 'current' : index < q.index ? 'played' : 'upcoming';
    return { track, index, place };
  });
}

/** How many queue entries come after the window (not sent by the player). */
export function queueRemainder(q: QueueWindow): number {
  return Math.max(0, q.total - (q.offset + q.tracks.length));
}
