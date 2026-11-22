import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialHubState, useHubStore } from '../store/useHubStore.ts';
import { HubConnection } from './HubConnection.ts';

/** A WebSocket stand-in the tests drive by hand. */
class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const welcome = {
  t: 'welcome',
  v: 1,
  you: 'w',
  devices: [],
  state: null,
  settings: {},
  syncConfig: {},
  syncCatalog: [],
  serverCheck: true,
  queues: {},
};

describe('HubConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.all = [];
    useHubStore.setState({ ...initialHubState, mode: 'password' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a dropped connection comes back with growing pauses', () => {
    const hub = new HubConnection();
    hub.connect();
    FakeSocket.all[0].open();
    FakeSocket.all[0].receive(welcome);
    FakeSocket.all[0].drop(1006);
    expect(useHubStore.getState().status).toBe('reconnecting');

    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);

    FakeSocket.all[1].drop(1006);
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);
  });

  it('stops retrying when its address is locked out or has too many connections', () => {
    for (const [code, status] of [
      [4011, 'lockedOut'],
      [4010, 'tooManyConnections'],
    ] as const) {
      FakeSocket.all = [];
      const hub = new HubConnection();
      hub.connect();
      FakeSocket.all[0].drop(code);
      vi.advanceTimersByTime(60_000);
      expect(FakeSocket.all).toHaveLength(1);
      expect(useHubStore.getState().status).toBe(status);
      expect(useHubStore.getState().login.visible).toBe(true);
    }
  });

  it('an ended session shows the login instead of reconnecting', () => {
    const hub = new HubConnection();
    hub.connect();
    FakeSocket.all[0].drop(4005);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(useHubStore.getState().status).toBe('signedOut');
  });

  it('commands go to the playing device, and nowhere when nothing plays', () => {
    const hub = new HubConnection();
    hub.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    ws.receive({ ...welcome, devices: [{ id: 'desk', name: 'Desk', kind: 'desktop', active: false, server: [] }] });
    hub.command('next');
    expect(ws.sent.filter((m) => (m as { t: string }).t === 'command')).toEqual([]);

    ws.receive({ t: 'devices', devices: [{ id: 'desk', name: 'Desk', kind: 'desktop', active: true, server: [] }] });
    hub.command('next');
    expect(ws.sent.at(-1)).toEqual({ t: 'command', to: 'desk', action: 'next' });
  });

  it('a library lookup resolves with the matching answer, and with a timeout when none comes', async () => {
    const hub = new HubConnection();
    hub.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    const answered = hub.browse('desk', { kind: 'playlists' });
    const rid = (ws.sent.at(-1) as { rid: string }).rid;
    ws.receive({ t: 'browse-result', rid: 'someone-else', result: { playlists: [{ id: 'x' }] } });
    ws.receive({ t: 'browse-result', rid, result: { playlists: [{ id: 'p1' }] } });
    expect(await answered).toEqual({ result: { playlists: [{ id: 'p1' }] }, error: undefined });

    const silent = hub.browse('desk', { kind: 'playlists' });
    vi.advanceTimersByTime(20_000);
    expect(await silent).toEqual({ error: 'timeout' });
  });

  it('a player that left takes its queue with it', () => {
    const hub = new HubConnection();
    hub.connect();
    const ws = FakeSocket.all[0];
    ws.open();
    const desk = { id: 'desk', name: 'Desk', kind: 'desktop', active: true, server: [] };

    ws.receive({
      ...welcome,
      devices: [desk],
      queues: { desk: { index: 0, offset: 0, total: 1, tracks: [{ id: 't' }] } },
    });

    expect(Object.keys(useHubStore.getState().queues)).toEqual(['desk']);
    ws.receive({ t: 'devices', devices: [] });
    expect(useHubStore.getState().queues).toEqual({});
  });
});
