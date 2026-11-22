import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Notice } from '../types.ts';

const connect = vi.fn();

vi.mock('./HubConnection.ts', () => ({
  hub: {
    connect: () => connect(),
    showLogin: (message: Notice | null) => useHubStore.setState({ login: { visible: true, message } }),
  },
}));

const { initialHubState, useHubStore } = await import('../store/useHubStore.ts');
const { startSession } = await import('./startSession.ts');

const reply = (body: unknown, ok = true) => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);

describe('startSession', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    connect.mockReset();
    useHubStore.setState({ ...initialHubState });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('an unreachable hub says so and keeps trying, instead of asking for a token', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal('fetch', fetchMock);
    await startSession();

    const s = useHubStore.getState();
    expect(s.mode).toBeNull();
    expect(s.status).toBe('reconnecting');
    expect(s.login.message).toEqual({ key: 'login.unreachable' });

    fetchMock.mockImplementation((url: string) =>
      reply(url === '/auth/config' ? { mode: 'password' } : {}, url !== '/auth/me'),
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(useHubStore.getState().mode).toBe('password');
    expect(useHubStore.getState().login).toEqual({ visible: true, message: null });
  });

  it('a signed-in session connects straight away', async () => {
    vi.stubGlobal('fetch', (url: string) => reply(url === '/auth/config' ? { mode: 'password' } : { ok: true }));
    await startSession();
    expect(connect).toHaveBeenCalledOnce();
  });
});
