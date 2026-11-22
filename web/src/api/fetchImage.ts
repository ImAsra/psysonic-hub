import { STORAGE } from '../constants.ts';
import { useHubStore } from '../store/useHubStore.ts';
import { storage } from '../utils/storage.ts';

/**
 * An image from the hub's API as an object URL, or null. Token mode needs the Authorization
 * header, so images cannot be plain <img src> links.
 */
export async function fetchImage(path: string): Promise<string | null> {
  try {
    const headers: Record<string, string> =
      useHubStore.getState().mode === 'token' ? { authorization: 'Bearer ' + storage.get(STORAGE.token) } : {};
    const r = await fetch(path, { headers, credentials: 'same-origin' });
    if (!r.ok) return null;
    return URL.createObjectURL(await r.blob());
  } catch {
    return null;
  }
}
