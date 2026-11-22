import { letterRank } from './letterRank.ts';

export interface RailLetter {
  letter: string;
  /** 'here': loaded; 'none': the list has nothing under it; 'unknown': not loaded yet. */
  state: 'here' | 'none' | 'unknown';
}

const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

/**
 * The letters of the index: '#', A–Z, then letters of other scripts found in the list. `found` are
 * the letters loaded so far, in order; `complete` says the whole list is loaded.
 */
export function railLetters(found: string[], complete: boolean): RailLetter[] {
  const others = found.filter((l) => letterRank(l) === 27);
  // How far the sorted list is loaded: its last section (one oddly sorted name can't skip letters).
  const top = found.length ? letterRank(found.at(-1)!) : -1;
  const has = new Set(found);

  return ['#', ...ALPHABET, ...others].map((letter) => {
    if (has.has(letter)) return { letter, state: 'here' };
    // The list is sorted, so a letter before the last one loaded has nothing under it.
    const passed = letterRank(letter) < top;
    return { letter, state: complete || passed ? 'none' : 'unknown' };
  });
}
