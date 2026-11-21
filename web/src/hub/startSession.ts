import { RECONNECT_MAX_MS, STORAGE } from '../constants.ts';
import i18n from '../i18n.ts';
import { useHubStore } from '../store/useHubStore.ts';
import type { AuthMode } from '../types.ts';
import { storage } from '../utils/storage.ts';
import { hub } from './HubConnection.ts';

/** How this hub signs in the page, or null when the hub cannot be reached. */
async function authMode(): Promise<AuthMode | null> {
  try {
    const r = await fetch('/auth/config', { credentials: 'same-origin' });
    if (!r.ok) return null;
    return ((await r.json()) as { mode: AuthMode }).mode === 'password' ? 'password' : 'token';
  } catch {
    return null;
  }
}

/**
 * On page load: find out how to sign in, then connect if a session or token is already there.
 * While the hub is unreachable (e.g. the installed app opened offline) it says so and keeps trying,
 * instead of guessing a sign-in form.
 */
export async function startSession(attempt = 0): Promise<void> {
  const mode = await authMode();

  if (!mode) {
    useHubStore.setState({
      mode: null,
      status: 'reconnecting',
      login: { visible: true, message: i18n.t('login.unreachable') },
    });

    setTimeout(() => void startSession(attempt + 1), Math.min(1000 * 2 ** attempt, RECONNECT_MAX_MS));
    return;
  }

  useHubStore.setState({ mode, login: { visible: false, message: '' } });

  if (mode === 'password') {
    const me = await fetch('/auth/me', { credentials: 'same-origin' }).catch(() => null);
    if (me?.ok) return hub.connect();
    return hub.showLogin('');
  }

  if (storage.get(STORAGE.token)) return hub.connect();
  hub.showLogin('');
}
