/**
 * Copies text to the clipboard. Over plain http (no clipboard API) the field's text is selected
 * and copied the old way. Returns whether it worked.
 */
export async function copyText(text: string, field?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back to selecting the field */
  }

  if (!field) return false;
  field.focus();
  field.select();
  return document.execCommand('copy');
}
