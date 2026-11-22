import { describe, expect, it } from 'vitest';

import { letterSections } from './letterSections.ts';
import { railLetters } from './railLetters.ts';
import { sortLetter } from './sortLetter.ts';

describe('the letter a name is filed under', () => {
  it('is the first letter, in capitals and without accents', () => {
    expect(sortLetter('cleopatrick')).toBe('C');
    expect(sortLetter('Émilie Simon')).toBe('E');
    expect(sortLetter('  Ølafur Arnalds')).toBe('O');
    expect(sortLetter('Ænima')).toBe('A');
    expect(sortLetter('ßtraße')).toBe('S');
  });

  it('skips a leading article, like Navidrome', () => {
    expect(sortLetter('The xx')).toBe('X');
    expect(sortLetter('A Perfect Circle')).toBe('P');
    expect(sortLetter('Los Lobos')).toBe('L');
  });

  it('keeps an article that is the whole name, or the start of a longer word', () => {
    expect(sortLetter('The')).toBe('T');
    expect(sortLetter('Theory of a Deadman')).toBe('T');
    expect(sortLetter('Alice In Chains')).toBe('A');
  });

  it("is '#' for names that start with a digit or a symbol, or have none", () => {
    expect(sortLetter('1000 Mods')).toBe('#');
    expect(sortLetter('!!!')).toBe('#');
    expect(sortLetter('')).toBe('#');
    expect(sortLetter(undefined)).toBe('#');
  });

  it('is the first letter of other scripts too', () => {
    expect(sortLetter('Кино')).toBe('К');
  });
});

describe('letter sections', () => {
  const names = (...n: string[]) => n.map((name) => ({ name }));
  const shape = (items: { name: string }[]) =>
    letterSections(items, (i) => i.name).map((s) => `${s.letter}:${s.items.map((i) => i.name).join(',')}`);

  it('groups a sorted list under each letter, keeping the order', () => {
    expect(shape(names('2Pac', 'ABBA', 'Air', 'Björk', 'The Cure'))).toEqual([
      '#:2Pac',
      'A:ABBA,Air',
      'B:Björk',
      'C:The Cure',
    ]);
  });

  it('gives every letter one section, even when the server sorts a name elsewhere', () => {
    // The server put "The Beatles" among the T's; it stays there rather than opening a second B.
    expect(shape(names('Beck', 'Tame Impala', 'The Beatles', 'Tool'))).toEqual([
      'B:Beck',
      'T:Tame Impala,The Beatles,Tool',
    ]);
  });
});

describe('the index letters', () => {
  const states = (found: string[], complete: boolean) =>
    Object.fromEntries(railLetters(found, complete).map((r) => [r.letter, r.state]));

  it('marks loaded letters, letters passed without entries, and letters not loaded yet', () => {
    const s = states(['A', 'C'], false);
    expect(s.A).toBe('here');
    expect(s.B).toBe('none');
    expect(s['#']).toBe('none');
    expect(s.D).toBe('unknown');
    expect(s.Z).toBe('unknown');
  });

  it('knows every missing letter is empty once the whole list is loaded', () => {
    const s = states(['A', 'C'], true);
    expect(s.D).toBe('none');
    expect(s.Z).toBe('none');
  });

  it('judges how far the list is loaded by its last section, not one oddly sorted name', () => {
    const s = states(['A', 'К', 'C'], false);
    expect(s.D).toBe('unknown');
    expect(s.B).toBe('none');
  });

  it('lists letters of other scripts after Z', () => {
    expect(
      railLetters(['A', 'К'], true)
        .map((r) => r.letter)
        .slice(-2),
    ).toEqual(['Z', 'К']);
  });
});
