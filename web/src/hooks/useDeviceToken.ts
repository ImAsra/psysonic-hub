import { useCallback, useEffect, useState } from 'react';

import { deviceToken } from '../api/deviceToken.ts';
import { STORAGE } from '../constants.ts';
import { hub } from '../hub/HubConnection.ts';
import { useHubStore } from '../store/useHubStore.ts';
import type { TokenInfo } from '../types.ts';
import { storage } from '../utils/storage.ts';

/** The device token for the Settings page, and regenerating it. */
export function useDeviceToken(): {
  info: TokenInfo | null;
  error: string;
  regenerate: () => Promise<void>;
} {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    void deviceToken().then((r) => {
      if (cancelled) return;
      if ('error' in r) setError(r.error);
      else setInfo(r);
    });

    return () => void (cancelled = true);
  }, []);

  const regenerate = useCallback(async () => {
    const r = await deviceToken(true);

    if ('error' in r) {
      setError(r.error);
      return;
    }

    setError('');
    setInfo(r);

    // Signed in with the token itself: the hub just closed this page's connection too, so carry on with the new one.
    if (useHubStore.getState().mode === 'token') {
      storage.set(STORAGE.token, r.token);
      hub.connect(r.token);
    }
  }, []);

  return { info, error, regenerate };
}
