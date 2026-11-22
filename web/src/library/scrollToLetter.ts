import { letterRank } from './letterRank.ts';

/** Scrolls to a letter's section, or to the next one when it has none (the last one after the end). */
export function scrollToLetter(container: HTMLElement | null, letter: string): void {
  const heads = [...(container?.querySelectorAll<HTMLElement>('.letter-head') ?? [])];
  const rank = letterRank(letter);
  const head =
    heads.find((h) => h.dataset.letter === letter) ??
    heads.find((h) => letterRank(h.dataset.letter ?? '') > rank) ??
    heads.at(-1);
  head?.scrollIntoView({ block: 'start' });
}
