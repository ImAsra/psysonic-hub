import { STORAGE } from '../constants.ts';
import { useHubStore } from '../store/useHubStore.ts';
import type { TokenInfo } from '../types.ts';
import { storage } from '../utils/storage.ts';

/**
 * The device token, or (with `regenerate`) a new one replacing it. The page proves it is signed in
 * with its login session, or in token mode with the token it signed in with.
 */
export async function deviceToken(regenerate = false): Promise<TokenInfo | { error: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (useHubStore.getState().mode === 'token') headers.authorization = 'Bearer ' + storage.get(STORAGE.token);

  try {
    const r = await fetch('/settings/token', {
      method: regenerate ? 'POST' : 'GET',
      headers,
      credentials: 'same-origin',
      ...(regenerate ? { body: '{}' } : {}),
    });
    const data = (await r.json().catch(() => ({}))) as Partial<TokenInfo> & { error?: string };
    if (!r.ok || !data.token) return { error: data.error ?? 'failed' };
    return { token: data.token, source: data.source ?? 'generated' };
  } catch {
    return { error: 'unreachable' };
  }
}
