import i18n from '../i18n.ts';
import { useHubStore } from '../store/useHubStore.ts';
import { hub } from './HubConnection.ts';

/**
 * Signs in with the login form. Token mode just connects with the token; password mode posts
 * the login first. Returns the message to show, or '' when the page goes on to connect.
 */
export async function signIn(user: string, password: string, token: string): Promise<string> {
  if (useHubStore.getState().mode === 'token') {
    hub.connect(token);
    return '';
  }

  try {
    const r = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user, password }),
    });

    if (r.ok) {
      hub.connect();
      return '';
    }

    if (r.status === 429) {
      const { retryAfter } = (await r.json().catch(() => ({}))) as { retryAfter?: number };
      return i18n.t('login.tooManyAttempts', { minutes: Math.max(1, Math.ceil((retryAfter || 60) / 60)) });
    }

    return i18n.t('login.wrongCredentials');
  } catch {
    return i18n.t('login.unreachable');
  }
}
