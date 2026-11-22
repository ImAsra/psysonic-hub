import { describe, expect, it } from 'vitest';

import { formatTime } from './formatTime.ts';
import { joinMeta } from './joinMeta.ts';
import { playbackPosition } from './playbackPosition.ts';
import { queueRemainder, queueRows } from './queueRows.ts';
import { sliderFill } from './sliderFill.ts';

describe('formatTime', () => {
  it('shows minutes and zero-padded seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(3599.6)).toBe('60:00');
  });

  it('treats missing and negative times as zero', () => {
    expect(formatTime(undefined)).toBe('0:00');
    expect(formatTime(-5)).toBe('0:00');
  });
});

describe('playbackPosition', () => {
  it('advances while playing, from the moment the position was reported', () => {
    expect(playbackPosition({ positionSec: 10, playing: true, durationSec: 100 }, 1_000, 4_000)).toBe(13);
  });

  it('stays put while paused', () => {
    expect(playbackPosition({ positionSec: 10, playing: false, durationSec: 100 }, 1_000, 60_000)).toBe(10);
  });

  it('never runs past the end of the track', () => {
    expect(playbackPosition({ positionSec: 95, playing: true, durationSec: 100 }, 0, 60_000)).toBe(100);
  });

  it('is zero when nothing was reported', () => {
    expect(playbackPosition(null, 0)).toBe(0);
  });
});

describe('queueRows', () => {
  const q = { index: 6, offset: 5, total: 20, tracks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };

  it('numbers rows by their place in the whole queue and marks played, current and upcoming', () => {
    expect(queueRows(q).map((r) => [r.index, r.place])).toEqual([
      [5, 'played'],
      [6, 'current'],
      [7, 'upcoming'],
    ]);
  });

  it('counts the tracks after the window the player sent', () => {
    expect(queueRemainder(q)).toBe(12);
    expect(queueRemainder({ ...q, total: 8 })).toBe(0);
  });
});

describe('sliderFill', () => {
  it('fills in proportion and stays within 0–100%', () => {
    expect(sliderFill(0.25, 0, 1)).toBe('25%');
    expect(sliderFill(5, 0, 1)).toBe('100%');
    expect(sliderFill(-1, 0, 1)).toBe('0%');
  });

  it('shows an empty bar when the range is empty', () => {
    expect(sliderFill(3, 0, 0)).toBe('0%');
  });
});

describe('joinMeta', () => {
  it('skips empty parts but keeps zero', () => {
    expect(joinMeta('Artist', undefined, '', 'Album', 0)).toBe('Artist · Album · 0');
  });
});
