import { PROTOCOL } from '../../../shared/protocol.ts';
import { BROWSE_TIMEOUT_MS, RECONNECT_MAX_MS, STORAGE } from '../constants.ts';
import i18n from '../i18n.ts';
import { useHubStore } from '../store/useHubStore.ts';
import type { BrowseRequest, BrowseResult, HubMessage } from '../types.ts';
import { storage } from '../utils/storage.ts';
import { playersUpdate } from './playersUpdate.ts';
import { welcomeState } from './welcomeState.ts';

export interface BrowseAnswer {
  result?: BrowseResult;
  error?: string;
}

const t = (key: string) => i18n.t(key);
const set = useHubStore.setState;

/**
 * The page's connection to the hub: signs in over the WebSocket, keeps the store up to date,
 * reconnects with backoff, and sends commands, transfers and library lookups.
 */
export class HubConnection {
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private ridSeq = 0;
  private readonly browseWaiters = new Map<string, (answer: BrowseAnswer) => void>();
  readonly deviceId: string;

  constructor() {
    this.deviceId = storage.get(STORAGE.deviceId) || 'web-' + Math.random().toString(36).slice(2, 12);
    storage.set(STORAGE.deviceId, this.deviceId);
  }

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Opens the connection. In token mode `token` (or the remembered one) signs in. */
  connect(token?: string): void {
    const { mode } = useHubStore.getState();
    const tok = mode === 'token' ? token || storage.get(STORAGE.token) : null;
    if (mode === 'token' && !tok) return this.showLogin('');
    if (tok) storage.set(STORAGE.token, tok);
    clearTimeout(this.retryTimer);
    this.detach();
    set({ status: 'connecting' });

    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    this.ws = ws;

    // Password mode: no token is sent; the login session cookie authenticates the page.
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          t: 'hello',
          v: PROTOCOL,
          token: tok,
          deviceId: this.deviceId,
          name: 'psysonic-hub',
          kind: 'web',
        }),
      );

    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as HubMessage);
    ws.onclose = (e) => this.onClose(e.code);
  }

  /** Closes the connection without reconnecting (signed out). */
  disconnect(): void {
    clearTimeout(this.retryTimer);
    this.detach();
  }

  showLogin(message: string): void {
    set({ login: { visible: true, message } });
  }

  send(msg: unknown): boolean {
    if (!this.open) return false;
    this.ws!.send(JSON.stringify(msg));
    return true;
  }

  /** A command for the playing device (ignored when nothing plays). */
  command(action: string, args?: Record<string, unknown>): void {
    const to = useHubStore.getState().devices.find((d) => d.active)?.id;
    if (to) this.send({ t: 'command', to, action, args });
  }

  /** A command for a specific device. */
  commandTo(to: string, action: string, args?: Record<string, unknown>): void {
    this.send({ t: 'command', to, action, args });
  }

  transfer(to: string): void {
    this.send({ t: 'transfer', to });
  }

  setSync(category: string, enabled: boolean): void {
    this.send({ t: 'sync-config', category, enabled });
  }

  /** Asks player `to` to look something up in its library. */
  browse(to: string, req: BrowseRequest): Promise<BrowseAnswer> {
    return new Promise((resolve) => {
      const rid = 'r' + ++this.ridSeq + '-' + Math.random().toString(36).slice(2, 8);
      if (!this.send({ t: 'browse', to, rid, req })) return resolve({ error: 'no_player' });
      this.browseWaiters.set(rid, resolve);

      setTimeout(() => {
        if (this.browseWaiters.delete(rid)) resolve({ error: 'timeout' });
      }, BROWSE_TIMEOUT_MS);
    });
  }

  private detach(): void {
    if (!this.ws) return;
    this.ws.onopen = this.ws.onmessage = this.ws.onclose = null;
    this.ws.close();
    this.ws = null;
  }

  private onMessage(m: HubMessage): void {
    const { queues } = useHubStore.getState();

    switch (m.t) {
      case 'welcome':
        this.retry = 0;
        return set(welcomeState(m));
      case 'devices':
        return set(playersUpdate(m.devices, queues));
      case 'state':
        return set({ state: m.state, stateAt: Date.now() });
      case 'queue':
        return set({ queues: { ...queues, [m.from]: m.queue } });
      case 'sync-config':
        return set({ syncConfig: m.config ?? {} });
      case 'browse-result':
        return this.answerBrowse(m.rid, { result: m.result, error: m.error });
    }
  }

  private answerBrowse(rid: string, answer: BrowseAnswer): void {
    const resolve = this.browseWaiters.get(rid);
    if (!resolve) return;
    this.browseWaiters.delete(rid);
    resolve(answer);
  }

  private onClose(code: number): void {
    this.ws = null;

    // The hub refuses this address for now: stop retrying.
    if (code === 4011 || code === 4010) {
      set({ status: code === 4011 ? 'lockedOut' : 'tooManyConnections' });
      return this.showLogin(t(code === 4011 ? 'login.lockedOut' : 'login.tooManyConnections'));
    }

    if (code === 4005) {
      const password = useHubStore.getState().mode === 'password';
      set({ status: password ? 'signedOut' : 'wrongToken' });
      return this.showLogin(t(password ? 'login.sessionEnded' : 'login.wrongToken'));
    }

    set({ status: 'reconnecting' });
    this.retryTimer = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, RECONNECT_MAX_MS));
  }
}

/** The page's one connection. */
export const hub = new HubConnection();
