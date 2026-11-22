/** Leading words Navidrome ignores when it sorts names (its default list). */
const ARTICLES = new Set(['the', 'el', 'la', 'los', 'las', 'le', 'les', 'os', 'as', 'o', 'a']);

/** Latin letters that dropping accents doesn't simplify, filed under their base letter. */
const BASE: Record<string, string> = { Æ: 'A', Ø: 'O', Œ: 'O', Ð: 'D', Đ: 'D', Þ: 'T', ẞ: 'S', Ł: 'L', Ħ: 'H' };

/**
 * The letter a name is filed under: its first letter, without accents and after a leading article
 * ("The xx" under X), or '#' when it doesn't start with a letter.
 */
export function sortLetter(name: string | undefined): string {
  let s = (name ?? '').trim();
  const space = s.indexOf(' ');

  if (space > 0 && ARTICLES.has(s.slice(0, space).toLowerCase()) && s.slice(space + 1).trim()) {
    s = s.slice(space + 1).trim();
  }

  const first = [...s.normalize('NFD').replace(/\p{M}/gu, '')][0] ?? '';
  if (!/\p{L}/u.test(first)) return '#';

  const upper = first === 'ß' ? 'ẞ' : first.toLocaleUpperCase();
  return BASE[upper] ?? upper;
}
