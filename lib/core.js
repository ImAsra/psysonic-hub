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
const DEFAULT_CONFIG = Object.fromEntries(CATALOG.map((c) => [c.id, c.def]));

const YIELD_TIMEOUT_MS = 3000;
const COVER_MAX_BYTES = 1024 * 1024;
const COVER_TYPES = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

const ACTIONS = new Set(['play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'shuffle', 'repeat']);

export function createHub({ dataDir = '', maxDevices = 16 } = {}) {
  /** 'change' events: 'devices' | 'state' | 'cover' | 'config' (used by the SSE stream). */
  const events = new EventEmitter();
  events.setMaxListeners(100);

  const devices = new Map(); // id -> { ws, name, kind }
  let lastState = null; // state reported by the active device
  let activeId = null;
  let pending = null; // in-flight transfer
  let cover = null; // { trackId, mime, buf, etag }

  // ---- shared settings (persisted when a data dir is set) ----
  const settingsFile = dataDir ? path.join(dataDir, 'settings.json') : '';
  let sharedSettings = {};
  let syncConfig = { ...DEFAULT_CONFIG };
  if (settingsFile) {
    try {
      const raw = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (raw && raw.version === 2) {
        sharedSettings = raw.settings ?? {};
        syncConfig = { ...DEFAULT_CONFIG, ...(raw.config ?? {}) };
      } else if (raw && typeof raw === 'object') {
        sharedSettings = { playback: raw }; // first-generation file: flat playback settings
      }
    } catch { /* first run */ }
  }
  for (const k of Object.keys(sharedSettings)) if (!(k in DEFAULT_CONFIG)) delete sharedSettings[k];

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

  // ---- helpers ----
  const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const deviceList = () =>
    [...devices].map(([id, d]) => ({ id, name: d.name, kind: d.kind, active: id === activeId }));
  const broadcast = (msg, exceptId) => {
    for (const [id, d] of devices) if (id !== exceptId) send(d.ws, msg);
  };
  const announceDevices = () => {
    broadcast({ t: 'devices', devices: deviceList() });
    events.emit('change', 'devices');
  };

  // ---- devices ----
  function join(id, { ws, name, kind }) {
    if (!devices.has(id) && devices.size >= maxDevices) return { error: 'too many devices' };
    devices.get(id)?.ws.close(4008, 'replaced'); // same device reconnecting
    devices.set(id, {
      ws,
      name: String(name || 'Unknown').slice(0, 40),
      kind: ['desktop', 'phone', 'web'].includes(kind) ? kind : 'desktop',
    });
    send(ws, {
      t: 'welcome', v: PROTOCOL, you: id, devices: deviceList(), state: lastState,
      settings: sharedSettings, syncConfig, syncCatalog: CATALOG,
    });
    announceDevices();
    return {};
  }

  function leave(id, ws) {
    if (devices.get(id)?.ws !== ws) return;
    devices.delete(id);
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
  function reportState(id, state) {
    const playing = !!state.playing;
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
    if (!t || typeof action !== 'string') return false;
    send(t.ws, { t: 'command', from: fromId, action, args: args ?? null });
    return true;
  }

  /**
   * Move playback to `toId`. If another device is playing, ask it to pause and flush
   * its queue position first ("yield"), then tell the target to take over.
   */
  function transfer(toId, byId, fresh = false) {
    const target = devices.get(toId);
    if (!target || target.kind === 'web') return false; // web remotes can't play audio
    if (pending) clearTimeout(pending.timer);
    const prevId = activeId && activeId !== toId && devices.has(activeId) ? activeId : null;
    const finish = () => {
      if (pending?.to !== toId) return;
      clearTimeout(pending.timer);
      pending = null;
      const t = devices.get(toId);
      if (!t) return;
      activeId = toId;
      send(t.ws, {
        t: 'takeover', from: byId, state: lastState, fresh,
        ageMs: lastState ? Date.now() - lastState.ts : 0,
      });
      announceDevices();
    };
    pending = { to: toId, prevId, timer: setTimeout(finish, YIELD_TIMEOUT_MS), finish };
    if (!prevId) finish();
    else send(devices.get(prevId).ws, { t: 'yield', to: toId, from: byId });
    return true;
  }

  const yielded = (id) => { if (pending && pending.prevId === id) pending.finish(); };

  // ---- shared settings ----
  function updateSettings({ category, value, init }, ws) {
    const cat = String(category);
    if (!(cat in DEFAULT_CONFIG) || !syncConfig[cat]) return;
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
    const cat = String(category);
    if (!(cat in DEFAULT_CONFIG)) return false;
    syncConfig[cat] = enabled === true;
    if (!syncConfig[cat]) delete sharedSettings[cat]; // re-enabling starts fresh instead of reviving stale values
    saveSettings();
    broadcast({ t: 'sync-config', config: syncConfig });
    return true;
  }

  // ---- cover art (uploaded by the active device; the hub never talks to Navidrome) ----
  function setCover(id, { trackId, mime, data }) {
    if (!lastState || lastState.from !== id || trackId !== lastState.trackId) return false;
    const check = COVER_TYPES[mime];
    if (!check || typeof data !== 'string' || data.length > COVER_MAX_BYTES * 1.4) return false;
    const buf = Buffer.from(data, 'base64');
    if (buf.length < 16 || buf.length > COVER_MAX_BYTES || !check(buf)) return false;
    cover = { trackId, mime, buf, etag: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) };
    events.emit('change', 'cover');
    return true;
  }
  const getCover = (trackId) => (cover && (!trackId || trackId === cover.trackId) ? cover : null);

  // ---- REST-facing helpers ----
  function currentPosition() {
    const s = lastState;
    if (!s) return null;
    let pos = (s.positionSec ?? 0) + (s.playing ? (Date.now() - s.ts) / 1000 : 0);
    if (s.durationSec > 0) pos = Math.min(pos, s.durationSec);
    return Math.max(0, pos);
  }

  function snapshot(publicUrl = '') {
    const s = lastState;
    const act = activeId && devices.get(activeId);
    const pos = currentPosition();
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
      devices: deviceList().filter((d) => d.kind !== 'web'),
    };
  }

  /** A device by id or (case-insensitive) name. */
  function resolveDevice(ref) {
    if (typeof ref !== 'string' || !ref) return null;
    if (devices.has(ref)) return ref;
    const lower = ref.toLowerCase();
    for (const [id, d] of devices) if (d.name.toLowerCase() === lower) return id;
    return null;
  }

  /**
   * Validate + normalize a REST command and send it to the target device.
   * Relative values (delta) are turned into absolute ones here, from the last reported state.
   */
  function apiCommand(action, args, deviceRef) {
    if (!ACTIONS.has(action)) return { status: 400, error: 'unknown_action' };
    const toId = deviceRef ? resolveDevice(deviceRef) : activeId;
    if (deviceRef && !toId) return { status: 404, error: 'unknown_device' };
    if (!toId || !devices.has(toId)) return { status: 409, error: 'no_active_device' };
    if (devices.get(toId).kind === 'web') return { status: 400, error: 'device_cannot_play' };
    const a = args && typeof args === 'object' ? args : {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    let out = null;

    if (action === 'seek') {
      const abs = num(a.positionSec ?? a.position);
      const delta = num(a.delta);
      const dur = lastState?.durationSec > 0 ? lastState.durationSec : Infinity;
      let sec = abs ?? (delta !== null && currentPosition() !== null ? currentPosition() + delta : null);
      if (sec === null) return { status: 400, error: 'seek_needs_position_or_delta' };
      sec = Math.min(dur, Math.max(0, sec));
      out = { positionSec: sec };
    } else if (action === 'volume') {
      const abs = num(a.volume);
      const delta = num(a.delta);
      let v = abs ?? (delta !== null ? (lastState?.volume ?? 0.5) + delta : null);
      if (v === null) return { status: 400, error: 'volume_needs_volume_or_delta' };
      out = { volume: Math.min(1, Math.max(0, v)) };
    } else if (action === 'shuffle') {
      const v = a.value === 'toggle' ? !(lastState?.shuffle ?? false) : a.value;
      if (typeof v !== 'boolean') return { status: 400, error: 'shuffle_needs_boolean_or_toggle' };
      out = { value: v };
    } else if (action === 'repeat') {
      const order = ['off', 'all', 'one'];
      const v = a.value === 'cycle' ? order[(order.indexOf(lastState?.repeat ?? 'off') + 1) % 3] : a.value;
      if (!order.includes(v)) return { status: 400, error: 'repeat_needs_off_all_one_or_cycle' };
      out = { value: v };
    }
    command(toId, action, out, 'api');
    const d = devices.get(toId);
    return { status: 200, ok: true, target: { id: toId, name: d.name } };
  }

  function apiTransfer(deviceRef) {
    const toId = resolveDevice(deviceRef);
    if (!toId) return { status: 404, error: 'unknown_device' };
    if (devices.get(toId).kind === 'web') return { status: 400, error: 'device_cannot_play' };
    transfer(toId, 'api', false);
    return { status: 200, ok: true, target: { id: toId, name: devices.get(toId).name } };
  }

  return {
    events, CATALOG, deviceList, broadcast, send,
    join, leave, reportState, command, transfer, yielded,
    updateSettings, setSyncConfig, setCover, getCover,
    snapshot, apiCommand, apiTransfer, resolveDevice,
    relaySettings: (cat, value, fromId) => broadcast({ t: 'settings', category: cat, value }, fromId),
    get sharedSettings() { return sharedSettings; },
    get syncConfig() { return syncConfig; },
  };
}
