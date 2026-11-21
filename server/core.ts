// Hub core: devices, playback state, transfers, commands, shared settings and cover art.
// Transport-agnostic: the WebSocket server and the REST API both call into this.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { WebSocket } from 'ws';
import type { Device, DeviceKind, PlayerState, QueueTrack, QueueWindow, RelayedState, SyncCategory } from '../shared/protocol.ts';
import { PROTOCOL } from '../shared/protocol.ts';

export { PROTOCOL };

type Json = Record<string, unknown>;
type CleanArgs = Record<string, unknown> | null;

interface DeviceEntry {
  ws: WebSocket;
  name: string;
  kind: DeviceKind;
  server: string[];
  state: (PlayerState & { ts: number }) | null; // the latest state THIS device reported
  queue: QueueWindow | null; // the latest queue window THIS device reported
}
interface Cover { trackId: string; mime: string; buf: Buffer; etag: string }
interface PendingTransfer {
  to: string;
  prevId: string | null;
  timer: NodeJS.Timeout;
  finish: () => void;
  abort: (reason: string) => void;
}
export interface ApiResult { status: number; [key: string]: unknown }
export interface HubOptions { dataDir?: string; maxDevices?: number; serverCheck?: boolean; yieldTimeoutMs?: number }

/** Drops keys whose value is undefined, so they are never stored or relayed. */
export function dropUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}


// Settings sync, in opt-in categories (toggled from the web page).
export const CATALOG: SyncCategory[] = [
  { id: 'playback', label: 'Playback', desc: 'Crossfade, AutoDJ, gapless, fades, infinite queue and shuffle behaviour', def: true },
  { id: 'loudness', label: 'Volume normalization', desc: 'ReplayGain and loudness settings, so every device sounds equally loud', def: true },
  { id: 'lyrics', label: 'Lyrics', desc: 'Lyrics sources and display options', def: false },
  { id: 'appearance', label: 'Appearance', desc: 'Theme (any theme installed on both devices; otherwise a device keeps its own), display options, fullscreen player and seekbar style, window button style. Interface scale, font, card grid size and the custom title bar are never shared', def: false },
  { id: 'eq', label: 'Equalizer', desc: 'Bands, pre-gain and custom presets. Headphones and speakers often need different EQ, so this is off by default', def: false },
  { id: 'keybindings', label: 'In-app keybindings', desc: 'Keyboard shortcuts inside the app', def: false },
];
const DEFAULT_CONFIG = Object.freeze(Object.fromEntries(CATALOG.map((c) => [c.id, c.def])));
const isCategory = (v: unknown): v is string => typeof v === 'string' && Object.hasOwn(DEFAULT_CONFIG, v); // NOT `in`: "__proto__" and "constructor" are `in` every object
const nullObj = <T,>(src: Record<string, T> = {}): Record<string, T> => Object.assign(Object.create(null), src); // no prototype to poison

const COVER_MAX_BYTES = 1024 * 1024;
// A Map, not an object: a client-supplied type like "__proto__" must never resolve to a function.
const COVER_TYPES = new Map<string, (b: Buffer) => boolean>([
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['image/webp', (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
]);

/** Opaque hashes of "music server + account" a device reports (see docs/PROTOCOL.md). */
const cleanServerKeys = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && /^[a-f0-9]{8,64}$/.test(k)).slice(0, 4) : [];
const serversMatch = (a: string[] | undefined, b: string[] | undefined) => !a?.length || !b?.length || a.some((k) => b.includes(k)); // unknown = compatible

const ACTIONS = new Set(['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'shuffle', 'repeat']);

export function createHub({ dataDir = '', maxDevices = 16, serverCheck = true, yieldTimeoutMs = 10_000 }: HubOptions = {}) {
  /** 'change' events: 'devices' | 'state' | 'cover' | 'config' (used by the SSE stream). */
  const events = new EventEmitter();
  events.setMaxListeners(100);

  const devices = new Map<string, DeviceEntry>();
  let lastState: RelayedState | null = null; // state reported by the active device
  let activeId: string | null = null;
  let pending: PendingTransfer | null = null; // in-flight transfer
  let lastTakeover: { to: string; by: string } | null = null; // the transfer that was just handed to a device
  let cover: Cover | null = null;

  // ---- shared settings (persisted when a data dir is set) ----
  const settingsFile = dataDir ? path.join(dataDir, 'settings.json') : '';
  let sharedSettings = nullObj<Json>();
  let syncConfig = nullObj<boolean>(DEFAULT_CONFIG);
  if (settingsFile) {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (raw && raw.version === 2) {
        for (const k of Object.keys(raw.settings ?? {})) if (isCategory(k)) sharedSettings[k] = raw.settings[k];
        for (const k of Object.keys(raw.config ?? {})) if (isCategory(k)) syncConfig[k] = raw.config[k] === true;
      } else if (raw && typeof raw === 'object') {
        sharedSettings.playback = raw; // first-generation file: flat playback settings
      }
    } catch { /* first run */ }
  }

  let saveTimer: NodeJS.Timeout | undefined;
  const saveSettings = () => {
    if (!settingsFile) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        const tmp = `${settingsFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ version: 2, settings: sharedSettings, config: syncConfig }));
        fs.renameSync(tmp, settingsFile);
      } catch (e) { console.error('could not save settings:', (e as Error).message); }
    }, 500);
  };
  const cleanValue = (v: unknown): Json | null => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (Object.keys(v).length > 200) return null;
    const json = JSON.stringify(v);
    return json.length <= 64 * 1024 ? JSON.parse(json) : null;
  };

  // ---- what devices may tell us: only known fields, bounded in size and range ----
  const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const finite = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  /** A device's reported state, reduced to the fields we use (the rest is dropped, never stored or relayed). */
  function cleanState(raw: unknown): PlayerState | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const s = raw as Json;
    const out: PlayerState = {
      trackId: str(s.trackId), title: str(s.title, 300), artist: str(s.artist, 300), album: str(s.album, 300),
      albumId: str(s.albumId), artistId: str(s.artistId), coverArt: str(s.coverArt),
      durationSec: finite(s.durationSec, 0, 1e6), positionSec: finite(s.positionSec, 0, 1e6), volume: finite(s.volume, 0, 1),
      playing: typeof s.playing === 'boolean' ? s.playing : undefined,
      shuffle: typeof s.shuffle === 'boolean' ? s.shuffle : undefined,
      repeat: s.repeat === 'off' || s.repeat === 'all' || s.repeat === 'one' ? s.repeat : undefined,
    };
    return dropUndefined(out);
  }
  const QUEUE_MAX_TRACKS = 300;
  /**
   * A window of a device's queue: `tracks` start at absolute position `offset`, `index` is the
   * current track's absolute position, `total` the full queue length.
   */
  function cleanQueue(raw: unknown): QueueWindow | null {
    const q = raw as Json | null;
    if (!q || typeof q !== 'object' || !Array.isArray(q.tracks)) return null;
    const total = finite(q.total, 0, 1e6) ?? q.tracks.length;
    const offset = Math.floor(finite(q.offset, 0, total) ?? 0);
    const index = Math.floor(finite(q.index, -1, total) ?? -1);
    const tracks: QueueTrack[] = [];
    for (const tr of (q.tracks as Json[]).slice(0, QUEUE_MAX_TRACKS)) {
      // Stop at the first bad entry: skipping it would shift every later track to the wrong position.
      if (!tr || typeof tr !== 'object' || typeof tr.id !== 'string') break;
      const out: QueueTrack = {
        id: tr.id.slice(0, 200), title: str(tr.title, 300), artist: str(tr.artist, 300), album: str(tr.album, 300),
        albumId: str(tr.albumId), artistId: str(tr.artistId), coverArt: str(tr.coverArt), durationSec: finite(tr.durationSec, 0, 1e6),
      };
      tracks.push(dropUndefined(out));
    }
    return { index, offset, total, tracks };
  }
  /** Command arguments: a small plain object or nothing. */
  const cleanArgs = (a: unknown): CleanArgs => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
    const json = JSON.stringify(a);
    return json.length <= 2048 ? JSON.parse(json) : null;
  };

  // ---- helpers ----
  const send = (ws: WebSocket, msg: unknown) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const deviceList = (): Device[] =>
    [...devices].map(([id, d]) => ({ id, name: d.name, kind: d.kind, active: id === activeId, server: d.server }));
  /** Can these two devices share a queue? (same music server + account, when both say which) */
  const compatible = (aId: string, bId: string) => !serverCheck || serversMatch(devices.get(aId)?.server, devices.get(bId)?.server);
  const notify = (id: string, msg: unknown) => { const d = devices.get(id); if (d) send(d.ws, msg); };
  const broadcast = (msg: unknown, exceptId?: string) => {
    for (const [id, d] of devices) if (id !== exceptId) send(d.ws, msg);
  };
  const queueMap = (): Record<string, QueueWindow> =>
    Object.fromEntries([...devices].flatMap(([id, d]) => (d.queue ? [[id, d.queue]] : [])));
  const announceDevices = () => {
    broadcast({ t: 'devices', devices: deviceList() });
    events.emit('change', 'devices');
  };

  // ---- devices ----
  function join(id: string, { ws, name, kind, server }: { ws: WebSocket; name: unknown; kind: unknown; server: unknown }) {
    if (!devices.has(id) && devices.size >= maxDevices) return { error: 'too many devices' };
    devices.get(id)?.ws.close(4008, 'replaced'); // same device reconnecting
    devices.set(id, {
      ws,
      name: String(name || 'Unknown').slice(0, 40),
      kind: kind === 'phone' || kind === 'web' ? kind : 'desktop',
      server: cleanServerKeys(server),
      state: null, // the latest state THIS device reported (relative REST commands start from it)
      queue: null, // the latest queue window THIS device reported
    });
    send(ws, {
      t: 'welcome', v: PROTOCOL, you: id, devices: deviceList(), state: lastState,
      settings: sharedSettings, syncConfig, syncCatalog: CATALOG, serverCheck, queues: queueMap(),
    });
    announceDevices();
    return {};
  }

  /** The user switched music server/account on a device. */
  function setServer(id: string, server: unknown) {
    const d = devices.get(id);
    if (!d) return;
    d.server = cleanServerKeys(server);
    announceDevices();
  }

  /** Returns true when the device really left (not when an old connection of it closes). */
  function leave(id: string, ws: WebSocket): boolean {
    if (devices.get(id)?.ws !== ws) return false;
    devices.delete(id);
    if (pending?.prevId === id) pending.finish(); // the playing device vanished mid-handoff: nothing left to wait for
    if (activeId === id) {
      activeId = null;
      // Like Spotify: when the active device disappears, playback stops. Keep the
      // last position so another device can pick up from there.
      if (lastState?.from === id) {
        const pos = (lastState.positionSec ?? 0) + (lastState.playing ? (Date.now() - lastState.ts) / 1000 : 0);
        lastState = { ...lastState, positionSec: pos, playing: false, ts: Date.now() };
        broadcast({ t: 'state', state: lastState });
      }
    }
    announceDevices();
    return true;
  }

  // ---- playback state ----
  function reportState(id: string, rawState: unknown) {
    const state = cleanState(rawState);
    if (!state) return;
    const playing = !!state.playing;
    const dev = devices.get(id);
    if (dev) dev.state = { ...state, ts: Date.now() };
    // Only one device plays at a time: a device that starts playing becomes the
    // active one and the previously active device is told to pause.
    if (playing && activeId && activeId !== id) {
      const old = devices.get(activeId);
      if (old) send(old.ws, { t: 'command', from: 'hub', action: 'pause', args: null });
    }
    if (playing) activeId = id;
    // Idle devices must not overwrite the "now playing" state of the active one.
    if (playing || id === activeId || !activeId) {
      lastState = { ...state, from: id, ts: Date.now() };
      if (cover && cover.trackId !== lastState.trackId) cover = null;
      broadcast({ t: 'state', state: lastState }, id);
    }
    announceDevices();
    events.emit('change', 'state');
  }

  /** A player's queue changed: keep it and pass it on (remotes show the active device's queue). */
  function reportQueue(id: string, raw: unknown) {
    const d = devices.get(id);
    const queue = cleanQueue(raw);
    if (!d || !queue) return false;
    d.queue = queue;
    broadcast({ t: 'queue', from: id, queue }, id);
    events.emit('change', 'queue');
    return true;
  }
  const activeDeviceId = () => (activeId && devices.has(activeId) ? activeId : null);
  /** A connected player, for requests any player can answer: the active one first. */
  const anyPlayer = () => activeDeviceId() ?? [...devices].find(([, d]) => d.kind !== 'web')?.[0] ?? null;
  /** The music server + account hashes a device reported (empty = unknown). */
  const serverKeys = (id: string): string[] => devices.get(id)?.server ?? [];
  const isPlayer = (id: string) => (devices.get(id)?.kind ?? 'web') !== 'web';

  function command(toId: string, action: unknown, args: unknown, fromId: string) {
    const t = devices.get(toId);
    if (!t || typeof action !== 'string' || action.length > 40) return false;
    send(t.ws, { t: 'command', from: fromId, action, args: cleanArgs(args) });
    return true;
  }

  /**
   * Move playback to `toId`.
   *
   * - Both ends must use the same music server + account, because the queue travels through that
   *   server (refused with `server_mismatch` otherwise).
   * - If another device is playing it is asked to pause and SAVE its queue position ("yield"), and
   *   the target only starts once that save is confirmed. If the save fails, or nothing answers
   *   within the timeout, the transfer is cancelled (and the old device resumes) instead of letting
   *   the target load an outdated queue.
   * Returns { ok: true } or { error }.
   */
  function transfer(toId: string, byId: string, fresh = false): { ok?: true; error?: string } {
    const target = devices.get(toId);
    if (!target || target.kind === 'web') return { error: 'device_cannot_play' }; // web remotes can't play audio
    // Whose queue is being moved: the requester's own (click-to-play) or the playing device's.
    const sourceId = fresh ? byId : (activeId && devices.has(activeId) ? activeId : null);
    if (sourceId && sourceId !== toId && devices.has(sourceId) && !compatible(sourceId, toId)) {
      return { error: 'server_mismatch' };
    }
    if (pending) clearTimeout(pending.timer);
    const prevId = activeId && activeId !== toId && devices.has(activeId) ? activeId : null;
    const wasPlaying = !!(prevId && lastState?.from === prevId && lastState.playing);

    const abort = (reason: string) => {
      const p = pending;
      if (p?.to !== toId) return;
      clearTimeout(p.timer);
      pending = null;
      if (wasPlaying && prevId) command(prevId, 'play', null, 'hub'); // carry on where it was
      notify(byId, { t: 'transfer-failed', to: toId, reason });
    };
    const finish = () => {
      const p = pending;
      if (p?.to !== toId) return;
      clearTimeout(p.timer);
      pending = null;
      const t = devices.get(toId);
      if (!t) return;
      activeId = toId;
      lastTakeover = { to: toId, by: byId };
      send(t.ws, {
        t: 'takeover', from: byId, state: lastState, fresh,
        ageMs: lastState ? Date.now() - lastState.ts : 0,
        server: (sourceId && devices.get(sourceId)?.server) ?? [], // lets the target double-check
      });
      announceDevices();
    };
    pending = { to: toId, prevId, timer: setTimeout(() => abort('timeout'), yieldTimeoutMs), finish, abort };
    if (!prevId) finish();
    else send(devices.get(prevId)!.ws, { t: 'yield', to: toId, from: byId });
    return { ok: true };
  }

  /** The playing device answered the yield: `ok: false` means its queue could NOT be saved. */
  const yielded = (id: string, ok = true, reason?: string) => {
    if (!pending || pending.prevId !== id) return;
    if (ok) pending.finish();
    else pending.abort(typeof reason === 'string' ? reason : 'queue_save_failed');
  };

  /** The target could not load the queue it was handed: nobody plays, tell whoever asked. */
  function takeoverFailed(id: string, reason: unknown) {
    const last = lastTakeover;
    if (last?.to !== id) return;
    const { by } = last;
    lastTakeover = null;
    if (activeId === id) activeId = null;
    announceDevices();
    notify(by, { t: 'transfer-failed', to: id, reason: typeof reason === 'string' ? reason.slice(0, 40) : 'takeover_failed' });
  }

  /** Relay to devices that can share a queue with `fromId` (so a queue change never reaches a foreign account). */
  function relayToCompatible(fromId: string, msg: unknown) {
    for (const [id, d] of devices) if (id !== fromId && compatible(fromId, id)) send(d.ws, msg);
  }

  // ---- shared settings ----
  function updateSettings({ category, value, init }: Json, ws: WebSocket): string | undefined {
    if (!isCategory(category) || !syncConfig[category]) return;
    const cat = category;
    const clean = cleanValue(value);
    if (!clean) return;
    // init = "I am only offering my values to an empty slot". If someone filled it already,
    // keep that value and tell this device to adopt it (avoids two devices racing to define it).
    if (init === true && sharedSettings[cat]) {
      send(ws, { t: 'settings', category: cat, value: sharedSettings[cat] });
      return;
    }
    sharedSettings[cat] = clean;
    saveSettings();
    return cat;
  }

  function setSyncConfig(category: unknown, enabled: unknown) {
    if (!isCategory(category)) return false;
    const cat = category;
    syncConfig[cat] = enabled === true;
    if (!syncConfig[cat]) delete sharedSettings[cat]; // re-enabling starts fresh instead of reviving stale values
    saveSettings();
    broadcast({ t: 'sync-config', config: syncConfig });
    return true;
  }

  // ---- cover art (uploaded by the active device; the hub never talks to Navidrome) ----
  function setCover(id: string, msg: unknown) {
    if (!msg || typeof msg !== 'object') return false;
    const { trackId, mime, data } = msg as Json;
    if (typeof trackId !== 'string' || typeof mime !== 'string' || typeof data !== 'string') return false;
    if (!lastState || lastState.from !== id || trackId !== lastState.trackId) return false;
    const check = COVER_TYPES.get(mime);
    if (!check || data.length > COVER_MAX_BYTES * 1.4) return false;
    const buf = Buffer.from(data, 'base64');
    if (buf.length < 16 || buf.length > COVER_MAX_BYTES || !check(buf)) return false;
    cover = { trackId, mime, buf, etag: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) };
    events.emit('change', 'cover');
    return true;
  }
  const getCover = (trackId: string) => (cover && (!trackId || trackId === cover.trackId) ? cover : null);

  // ---- REST-facing helpers ----
  /** Where a device's playback is right now, from the state it last reported. */
  function positionOf(st: (PlayerState & { ts: number }) | null | undefined): number | null {
    if (!st) return null;
    let pos = (st.positionSec ?? 0) + (st.playing ? (Date.now() - st.ts) / 1000 : 0);
    if (st.durationSec && st.durationSec > 0) pos = Math.min(pos, st.durationSec);
    return Math.max(0, pos);
  }

  function snapshot(publicUrl = '') {
    const s = lastState;
    const act = activeId && devices.get(activeId);
    const pos = positionOf(lastState);
    return {
      server_time: new Date().toISOString(),
      active_device: act ? { id: activeId, name: act.name, kind: act.kind } : null,
      playing: !!(act && s?.playing),
      track: s?.trackId
        ? {
            id: s.trackId,
            title: s.title ?? null,
            artist: s.artist ?? null,
            album: s.album ?? null,
            album_id: s.albumId ?? null,
            artist_id: s.artistId ?? null,
            duration_sec: s.durationSec ?? null,
            cover_url: cover && cover.trackId === s.trackId
              ? `${publicUrl}/api/cover?track=${encodeURIComponent(s.trackId)}&v=${cover.etag}`
              : null,
          }
        : null,
      position_sec: pos === null ? null : Math.round(pos * 10) / 10,
      volume: s?.volume ?? null,
      shuffle: s?.shuffle ?? null,
      repeat: s?.repeat ?? null,
      devices: deviceList().filter((d) => d.kind !== 'web').map(({ server, ...d }) => d),
    };
  }

  /**
   * A device by id, exact name, or part of a name (case-insensitive), so "laptop" finds
   * "Psysonic laptop". Partial matches only consider players and must be unambiguous.
   * Returns { id } or { error: 'unknown_device' | 'ambiguous_device', matches? }.
   */
  type Resolved = { id: string; error?: undefined; matches?: undefined } | { id?: undefined; error: string; matches?: string[] };
  function resolveDevice(ref: unknown): Resolved {
    const q = typeof ref === 'string' ? ref.trim().toLowerCase() : '';
    if (!q) return { error: 'unknown_device' };
    if (devices.has(ref as string)) return { id: ref as string };
    for (const [id, d] of devices) if (d.name.toLowerCase() === q) return { id };
    const players = [...devices].filter(([, d]) => d.kind !== 'web');
    const contains = players.filter(([, d]) => d.name.toLowerCase().includes(q));
    if (contains.length === 1) return { id: contains[0][0] };
    if (contains.length > 1) {
      const starts = contains.filter(([, d]) => d.name.toLowerCase().startsWith(q));
      if (starts.length === 1) return { id: starts[0][0] };
      return { error: 'ambiguous_device', matches: contains.map(([, d]) => d.name) };
    }
    return { error: 'unknown_device' };
  }
  const deviceError = (r: Resolved): ApiResult => ({
    status: r.error === 'ambiguous_device' ? 409 : 404,
    error: r.error,
    ...(r.matches ? { matches: r.matches } : {}),
  });

  /**
   * Validate + normalize a REST command and send it to the target device.
   * Relative values (delta) are turned into absolute ones here, from the last reported state.
   */
  function apiCommand(action: string, args: unknown, deviceRef?: string): ApiResult {
    if (!ACTIONS.has(action)) return { status: 400, error: 'unknown_action' };
    let toId = activeId;
    if (deviceRef) {
      const r = resolveDevice(deviceRef);
      if (r.error !== undefined) return deviceError(r);
      toId = r.id;
    }
    if (!toId || !devices.has(toId)) return { status: 409, error: 'no_active_device' };
    const target = devices.get(toId)!;
    if (target.kind === 'web') return { status: 400, error: 'device_cannot_play' };
    const a = (args && typeof args === 'object' ? args : {}) as Json;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    // Relative values (delta, toggle, cycle) start from what THIS device last reported, not from
    // whichever device happens to be the active one.
    const ref = target.state;
    const unknown = (field: string): ApiResult => ({ status: 409, error: 'device_state_unknown', field });
    let out: Json | null = null;

    if (action === 'seek') {
      const abs = num(a.positionSec ?? a.position);
      const delta = num(a.delta);
      if (abs === null && delta === null) return { status: 400, error: 'seek_needs_position_or_delta' };
      const base = positionOf(ref);
      if (abs === null && base === null) return unknown('position');
      const dur = ref?.durationSec && ref.durationSec > 0 ? ref.durationSec : Infinity;
      out = { positionSec: Math.min(dur, Math.max(0, abs ?? base! + delta!)) };
    } else if (action === 'volume') {
      const abs = num(a.volume);
      const delta = num(a.delta);
      if (abs === null && delta === null) return { status: 400, error: 'volume_needs_volume_or_delta' };
      if (abs === null && typeof ref?.volume !== 'number') return unknown('volume');
      out = { volume: Math.min(1, Math.max(0, abs ?? ref!.volume! + delta!)) };
    } else if (action === 'shuffle') {
      if (a.value === 'toggle') {
        if (typeof ref?.shuffle !== 'boolean') return unknown('shuffle');
        out = { value: !ref!.shuffle };
      } else if (typeof a.value === 'boolean') {
        out = { value: a.value };
      } else {
        return { status: 400, error: 'shuffle_needs_boolean_or_toggle' };
      }
    } else if (action === 'repeat') {
      const order: unknown[] = ['off', 'all', 'one'];
      if (a.value === 'cycle') {
        if (!order.includes(ref?.repeat)) return unknown('repeat');
        out = { value: order[(order.indexOf(ref!.repeat) + 1) % 3] };
      } else if (order.includes(a.value)) {
        out = { value: a.value };
      } else {
        return { status: 400, error: 'repeat_needs_off_all_one_or_cycle' };
      }
    }
    command(toId, action, out, 'api');
    return { status: 200, ok: true, target: { id: toId, name: target.name } };
  }

  function apiTransfer(deviceRef: string | undefined): ApiResult {
    const r = resolveDevice(deviceRef);
    if (r.error !== undefined) return deviceError(r);
    const toId = r.id;
    const out = transfer(toId, 'api', false);
    if (out.error) return { status: out.error === 'server_mismatch' ? 409 : 400, error: out.error };
    // The handoff itself is asynchronous (the playing device saves its queue first): check /api/state afterwards.
    return { status: 200, ok: true, target: { id: toId, name: devices.get(toId)?.name } };
  }

  return {
    events, CATALOG, deviceList, broadcast, send,
    join, leave, setServer, reportState, reportQueue, activeDeviceId, anyPlayer, isPlayer, serverKeys, notify, command, transfer, yielded, takeoverFailed, relayToCompatible,
    updateSettings, setSyncConfig, setCover, getCover,
    snapshot, apiCommand, apiTransfer, resolveDevice,
    relaySettings: (cat: string, value: unknown, fromId: string) => broadcast({ t: 'settings', category: cat, value }, fromId),
    get sharedSettings() { return sharedSettings; },
    get syncConfig() { return syncConfig; },
  };
}
