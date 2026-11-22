/** Non-empty parts joined with " · " (e.g. artist · album · year). */
export function joinMeta(...parts: (string | number | undefined | null)[]): string {
  return parts.filter((p) => p !== undefined && p !== null && p !== '').join(' · ');
}
