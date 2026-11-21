/** The message for a lookup that failed (translation key). */
export function errorMessage(error: string): string {
  if (error === 'no_player') return 'library.noPlayer';
  if (error === 'timeout') return 'library.timeout';
  return 'library.failed';
}
