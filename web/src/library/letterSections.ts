import { sortLetter } from './sortLetter.ts';

export interface LetterSection<T> {
  letter: string;
  items: T[];
}

/**
 * Groups a sorted list under its letters, in the server's order. An item filed under a letter that
 * already has a section stays where it is (servers sort a little differently), so every letter
 * heads one section.
 */
export function letterSections<T>(items: T[], nameOf: (item: T) => string | undefined): LetterSection<T>[] {
  const out: LetterSection<T>[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const letter = sortLetter(nameOf(item));
    const last = out.at(-1);

    if (last && (last.letter === letter || seen.has(letter))) {
      last.items.push(item);
    } else {
      out.push({ letter, items: [item] });
      seen.add(letter);
    }
  }

  return out;
}
