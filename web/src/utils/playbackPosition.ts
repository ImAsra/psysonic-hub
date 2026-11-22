import type { PlayerState } from '../types.ts';

/**
 * Where playback is now: the reported position, advanced by the time since the report while
 * playing, and never past the end of the track.
 */
export function playbackPosition(state: PlayerState | null, reportedAt: number, now = Date.now()): number {
  if (!state) return 0;
  const pos = (state.positionSec || 0) + (state.playing ? (now - reportedAt) / 1000 : 0);
  return state.durationSec ? Math.min(pos, state.durationSec) : pos;
}
