/** Seconds as m:ss (negative and missing values count as 0). */
export function formatTime(seconds: number | undefined): string {
  const s = Math.max(0, Math.round(seconds || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
