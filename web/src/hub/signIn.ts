import { useHubStore } from '../store/useHubStore.ts';
import type { Notice } from '../types.ts';
import { hub } from './HubConnection.ts';

/**
 * Signs in with the login form. Token mode just connects with the token; password mode posts
 * the login first. Returns the message to show, or null when the page goes on to connect.
 */
export async function signIn(user: string, password: string, token: string): Promise<Notice | null> {
  if (useHubStore.getState().mode === 'token') {
    hub.connect(token);
    return null;
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
      return null;
    }

    if (r.status === 429) {
      const { retryAfter } = (await r.json().catch(() => ({}))) as { retryAfter?: number };
      return { key: 'login.tooManyAttempts', values: { minutes: Math.max(1, Math.ceil((retryAfter || 60) / 60)) } };
    }

    return { key: 'login.wrongCredentials' };
  } catch {
    return { key: 'login.unreachable' };
  }
}
