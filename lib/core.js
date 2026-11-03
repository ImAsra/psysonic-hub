// Hub core: devices, playback state, transfers, commands, shared settings and cover art.
// Transport-agnostic: the WebSocket server and the REST API both call into this.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PROTOCOL = 1;

// Settings sync, in opt-in categories (toggled from the web page).
export const CATALOG = [
  { id: 'playback', label: 'Playback', desc: 'Crossfade, AutoDJ, gapless, fades, infinite queue and shuffle behaviour', def: true },
  { id: 'loudness', label: 'Volume normalization', desc: 'ReplayGain and loudness settings, so every device sounds equally loud', def: true },
  { id: 'lyrics', label: 'Lyrics', desc: 'Lyrics sources and display options', def: false },
  { id: 'appearance', label: 'Appearance', desc: 'Theme (any theme installed on both devices; otherwise a device keeps its own), display options, fullscreen player and seekbar style, window button style. Interface scale, font, card grid size and the custom title bar are never shared', def: false },
  { id: 'eq', label: 'Equalizer', desc: 'Bands, pre-gain and custom presets. Headphones and speakers often need different EQ, so this is off by default', def: false },
  { id: 'keybindings', label: 'In-app keybindings', desc: 'Keyboard shortcuts inside the app', def: false },
];
const DEFAULT_CONFIG = Object.freeze(Object.fromEntries(CATALOG.map((c) => [c.id, c.def])));
const isCategory = (v) => typeof v === 'string' && Object.hasOwn(DEFAULT_CONFIG, v); // NOT `in`: "__proto__" and "constructor" are `in` every object
const nullObj = (src = {}) => Object.assign(Object.create(null), src); // no prototype to poison

const COVER_MAX_BYTES = 1024 * 1024;
// A Map, not an object: a client-supplied type like "__proto__" must never resolve to a function.
const COVER_TYPES = new Map([
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['image/webp', (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
]);

/** Opaque hashes of "music server + account" a device reports (see docs/PROTOCOL.md). */
const cleanServerKeys = (v) =>
  Array.isArray(v) ? v.filter((k) => typeof k === 'string' && /^[a-f0-9]{8,64}$/.test(k)).slice(0, 4) : [];
const serversMatch = (a, b) => !a?.length || !b?.length || a.some((k) => b.includes(k)); // unknown = compatible

const ACTIONS = new Set(['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'shuffle', 'repeat']);

export function createHub({ dataDir = '', maxDevices = 16, serverCheck = true, yieldTimeoutMs = 10_000 } = {}) {
  /** 'change' events: 'devices' | 'state' | 'cover' | 'config' (used by the SSE stream). */
  const events = new EventEmitter();
  events.setMaxListeners(100);

  const devices = new Map(); // id -> { ws, name, kind }
  let lastState = null; // state reported by the active device
  let activeId = null;
  let pending = null; // in-flight transfer
  let lastTakeover = null; // { to, by } of the transfer that was just handed to a device
  let cover = null; // { trackId, mime, buf, etag }

  // ---- shared settings (persisted when a data dir is set) ----
  const settingsFile = dataDir ? path.join(dataDir, 'settings.json') : '';
  let sharedSettings = nullObj();
  let syncConfig = nullObj(DEFAULT_CONFIG);
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

  let saveTimer;
  const saveSettings = () => {
    if (!settingsFile) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        const tmp = `${settingsFile}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ version: 2, settings: sharedSettings, config: syncConfig }));
        fs.renameSync(tmp, settingsFile);
      } catch (e) { console.error('could not save settings:', e.message); }
    }, 500);
  };
  const cleanValue = (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    if (Object.keys(v).length > 200) return null;
    const json = JSON.stringify(v);
    return json.length <= 64 * 1024 ? JSON.parse(json) : null;
  };

  // ---- what devices may tell us: only known fields, bounded in size and range ----
  const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);
  const finite = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  /** A device's reported state, reduced to the fields we use (the rest is dropped, never stored or relayed). */
  function cleanState(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const out = {
      trackId: str(s.trackId), title: str(s.title, 300), artist: str(s.artist, 300), album: str(s.album, 300),
      albumId: str(s.albumId), artistId: str(s.artistId), coverArt: str(s.coverArt),
      durationSec: finite(s.durationSec, 0, 1e6), positionSec: finite(s.positionSec, 0, 1e6), volume: finite(s.volume, 0, 1),
      playing: typeof s.playing === 'boolean' ? s.playing : undefined,
      shuffle: typeof s.shuffle === 'boolean' ? s.shuffle : undefined,
      repeat: ['off', 'all', 'one'].includes(s.repeat) ? s.repeat : undefined,
    };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  }
  /** Command arguments: a small plain object or nothing. */
  const cleanArgs = (a) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
    const json = JSON.stringify(a);
    return json.length <= 2048 ? JSON.parse(json) : null;
  };

  // ---- helpers ----
  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const deviceList = () =>
    [...devices].map(([id, d]) => ({ id, name: d.name, kind: d.kind, active: id === activeId, server: d.server }));
  /** Can these two devices share a queue? (same music server + account, when both say which) */
  const compatible = (aId, bId) => !serverCheck || serversMatch(devices.get(aId)?.server, devices.get(bId)?.server);
  const notify = (id, msg) => { const d = devices.get(id); if (d) send(d.ws, msg); };
  const broadcast = (msg, exceptId) => {
    for (const [id, d] of devices) if (id !== exceptId) send(d.ws, msg);
  };
  const announceDevices = () => {
    broadcast({ t: 'devices', devices: deviceList() });
    events.emit('change', 'devices');
  };

  // ---- devices ----
  function join(id, { ws, name, kind, server }) {
    if (!devices.has(id) && devices.size >= maxDevices) return { error: 'too many devices' };
    devices.get(id)?.ws.close(4008, 'replaced'); // same device reconnecting
    devices.set(id, {
      ws,
      name: String(name || 'Unknown').slice(0, 40),
      kind: ['desktop', 'phone', 'web'].includes(kind) ? kind : 'desktop',
      server: cleanServerKeys(server),
      state: null, // the latest state THIS device reported (relative REST commands start from it)
    });
    send(ws, {
      t: 'welcome', v: PROTOCOL, you: id, devices: deviceList(), state: lastState,
      settings: sharedSettings, syncConfig, syncCatalog: CATALOG, serverCheck,
    });
    announceDevices();
    return {};
  }

  /** The user switched music server/account on a device. */
  function setServer(id, server) {
    const d = devices.get(id);
    if (!d) return;
    d.server = cleanServerKeys(server);
    announceDevices();
  }

  function leave(id, ws) {
    if (devices.get(id)?.ws !== ws) return;
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
  }

  // ---- playback state ----
  function reportState(id, rawState) {
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

  function command(toId, action, args, fromId) {
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
  function transfer(toId, byId, fresh = false) {
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

    const abort = (reason) => {
      if (pending?.to !== toId) return;
      clearTimeout(pending.timer);
      pending = null;
      if (wasPlaying) command(prevId, 'play', null, 'hub'); // carry on where it was
      notify(byId, { t: 'transfer-failed', to: toId, reason });
    };
    const finish = () => {
      if (pending?.to !== toId) return;
      clearTimeout(pending.timer);
      pending = null;
      const t = devices.get(toId);
      if (!t) return;
      activeId = toId;
      lastTakeover = { to: toId, by: byId };
      send(t.ws, {
        t: 'takeover', from: byId, state: lastState, fresh,
        ageMs: lastState ? Date.now() - lastState.ts : 0,
        server: devices.get(sourceId)?.server ?? [], // lets the target double-check
      });
      announceDevices();
    };
    pending = { to: toId, prevId, timer: setTimeout(() => abort('timeout'), yieldTimeoutMs), finish, abort };
    if (!prevId) finish();
    else send(devices.get(prevId).ws, { t: 'yield', to: toId, from: byId });
    return { ok: true };
  }

  /** The playing device answered the yield: `ok: false` means its queue could NOT be saved. */
  const yielded = (id, ok = true, reason) => {
    if (!pending || pending.prevId !== id) return;
    if (ok) pending.finish();
    else pending.abort(typeof reason === 'string' ? reason : 'queue_save_failed');
  };

  /** The target could not load the queue it was handed: nobody plays, tell whoever asked. */
  function takeoverFailed(id, reason) {
    if (lastTakeover?.to !== id) return;
    const { by } = lastTakeover;
    lastTakeover = null;
    if (activeId === id) activeId = null;
    announceDevices();
    notify(by, { t: 'transfer-failed', to: id, reason: typeof reason === 'string' ? reason.slice(0, 40) : 'takeover_failed' });
  }

  /** Relay to devices that can share a queue with `fromId` (so a queue change never reaches a foreign account). */
  function relayToCompatible(fromId, msg) {
    for (const [id, d] of devices) if (id !== fromId && compatible(fromId, id)) send(d.ws, msg);
  }

  // ---- shared settings ----
  function updateSettings({ category, value, init }, ws) {
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

  function setSyncConfig(category, enabled) {
    if (!isCategory(category)) return false;
    const cat = category;
    syncConfig[cat] = enabled === true;
    if (!syncConfig[cat]) delete sharedSettings[cat]; // re-enabling starts fresh instead of reviving stale values
    saveSettings();
    broadcast({ t: 'sync-config', config: syncConfig });
    return true;
  }

  // ---- cover art (uploaded by the active device; the hub never talks to Navidrome) ----
  function setCover(id, msg) {
    if (!msg || typeof msg !== 'object') return false;
    const { trackId, mime, data } = msg;
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
  const getCover = (trackId) => (cover && (!trackId || trackId === cover.trackId) ? cover : null);

  // ---- REST-facing helpers ----
  /** Where a device's playback is right now, from the state it last reported. */
  function positionOf(st) {
    if (!st) return null;
    let pos = (st.positionSec ?? 0) + (st.playing ? (Date.now() - st.ts) / 1000 : 0);
    if (st.durationSec > 0) pos = Math.min(pos, st.durationSec);
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
  function resolveDevice(ref) {
    const q = typeof ref === 'string' ? ref.trim().toLowerCase() : '';
    if (!q) return { error: 'unknown_device' };
    if (devices.has(ref)) return { id: ref };
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
  const deviceError = (r) => ({
    status: r.error === 'ambiguous_device' ? 409 : 404,
    error: r.error,
    ...(r.matches ? { matches: r.matches } : {}),
  });

  /**
   * Validate + normalize a REST command and send it to the target device.
   * Relative values (delta) are turned into absolute ones here, from the last reported state.
   */
  function apiCommand(action, args, deviceRef) {
    if (!ACTIONS.has(action)) return { status: 400, error: 'unknown_action' };
    let toId = activeId;
    if (deviceRef) {
      const r = resolveDevice(deviceRef);
      if (r.error) return deviceError(r);
      toId = r.id;
    }
    if (!toId || !devices.has(toId)) return { status: 409, error: 'no_active_device' };
    if (devices.get(toId).kind === 'web') return { status: 400, error: 'device_cannot_play' };
    const a = args && typeof args === 'object' ? args : {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    // Relative values (delta, toggle, cycle) start from what THIS device last reported, not from
    // whichever device happens to be the active one.
    const ref = devices.get(toId).state;
    const unknown = (field) => ({ status: 409, error: 'device_state_unknown', field });
    let out = null;

    if (action === 'seek') {
      const abs = num(a.positionSec ?? a.position);
      const delta = num(a.delta);
      if (abs === null && delta === null) return { status: 400, error: 'seek_needs_position_or_delta' };
      const base = positionOf(ref);
      if (abs === null && base === null) return unknown('position');
      const dur = ref?.durationSec > 0 ? ref.durationSec : Infinity;
      out = { positionSec: Math.min(dur, Math.max(0, abs ?? base + delta)) };
    } else if (action === 'volume') {
      const abs = num(a.volume);
      const delta = num(a.delta);
      if (abs === null && delta === null) return { status: 400, error: 'volume_needs_volume_or_delta' };
      if (abs === null && typeof ref?.volume !== 'number') return unknown('volume');
      out = { volume: Math.min(1, Math.max(0, abs ?? ref.volume + delta)) };
    } else if (action === 'shuffle') {
      if (a.value === 'toggle') {
        if (typeof ref?.shuffle !== 'boolean') return unknown('shuffle');
        out = { value: !ref.shuffle };
      } else if (typeof a.value === 'boolean') {
        out = { value: a.value };
      } else {
        return { status: 400, error: 'shuffle_needs_boolean_or_toggle' };
      }
    } else if (action === 'repeat') {
      const order = ['off', 'all', 'one'];
      if (a.value === 'cycle') {
        if (!order.includes(ref?.repeat)) return unknown('repeat');
        out = { value: order[(order.indexOf(ref.repeat) + 1) % 3] };
      } else if (order.includes(a.value)) {
        out = { value: a.value };
      } else {
        return { status: 400, error: 'repeat_needs_off_all_one_or_cycle' };
      }
    }
    command(toId, action, out, 'api');
    const d = devices.get(toId);
    return { status: 200, ok: true, target: { id: toId, name: d.name } };
  }

  function apiTransfer(deviceRef) {
    const r = resolveDevice(deviceRef);
    if (r.error) return deviceError(r);
    const toId = r.id;
    const out = transfer(toId, 'api', false);
    if (out.error) return { status: out.error === 'server_mismatch' ? 409 : 400, error: out.error };
    // The handoff itself is asynchronous (the playing device saves its queue first): check /api/state afterwards.
    return { status: 200, ok: true, target: { id: toId, name: devices.get(toId).name } };
  }

  return {
    events, CATALOG, deviceList, broadcast, send,
    join, leave, setServer, reportState, command, transfer, yielded, takeoverFailed, relayToCompatible,
    updateSettings, setSyncConfig, setCover, getCover,
    snapshot, apiCommand, apiTransfer, resolveDevice,
    relaySettings: (cat, value, fromId) => broadcast({ t: 'settings', category: cat, value }, fromId),
    get sharedSettings() { return sharedSettings; },
    get syncConfig() { return syncConfig; },
  };
}
