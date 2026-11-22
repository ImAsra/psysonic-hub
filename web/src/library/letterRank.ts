/** Where a letter falls in the index: '#' (names starting with digits sort first), A–Z, then other scripts. */
export function letterRank(letter: string): number {
  if (letter === '#') return 0;
  const code = letter.charCodeAt(0);
  if (letter.length === 1 && code >= 65 && code <= 90) return code - 64;
  return 27;
}
