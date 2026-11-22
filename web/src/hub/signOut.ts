import { initialHubState, useHubStore } from '../store/useHubStore.ts';
import { hub } from './HubConnection.ts';

/** Ends the web session, closes the connection and shows the login again. */
export async function signOut(): Promise<void> {
  try {
    const r = await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) throw new Error('Logout failed');
  } catch (error) {
    console.error('Sign out failed:', error);
    useHubStore.setState({ login: { ...useHubStore.getState().login, message: { key: 'login.signOutFailed' } } });
    return;
  }

  hub.disconnect();
  const { mode } = useHubStore.getState();

  useHubStore.setState({
    ...initialHubState,
    mode,
    login: { visible: true, message: { key: 'login.signedOut' } },
  });
}
