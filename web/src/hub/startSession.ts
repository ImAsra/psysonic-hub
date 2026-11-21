import { STORAGE } from '../constants.ts';
import { useHubStore } from '../store/useHubStore.ts';
import type { AuthMode } from '../types.ts';
import { storage } from '../utils/storage.ts';
import { hub } from './HubConnection.ts';

/** On page load: find out how to sign in, then connect if a session or token is already there. */
export async function startSession(): Promise<void> {
  let mode: AuthMode = 'token';

  try {
    const r = await fetch('/auth/config', { credentials: 'same-origin' });
    if (r.ok) mode = ((await r.json()) as { mode: AuthMode }).mode === 'password' ? 'password' : 'token';
  } catch {
    /* keep token mode */
  }

  useHubStore.setState({ mode });

  if (mode === 'password') {
    const me = await fetch('/auth/me', { credentials: 'same-origin' }).catch(() => null);
    if (me?.ok) return hub.connect();
    return hub.showLogin('');
  }

  if (storage.get(STORAGE.token)) return hub.connect();
  hub.showLogin('');
}
