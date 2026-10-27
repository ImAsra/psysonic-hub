const $ = (id) => document.getElementById(id);
const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const deviceId = store.get('deviceId') || ('web-' + Math.random().toString(36).slice(2, 12));
store.set('deviceId', deviceId);

// Logo: only shown if /logo.svg exists; otherwise the text brand stays.
const probe = new Image();
probe.onload = () => { $('logo').classList.add('ok'); $('brandName').classList.add('hidden'); };
probe.src = '/logo.svg';

let ws, devices = [], state = null, stateAt = 0, retry = 0, dragging = false, volDragging = false;
let catalog = [], syncCfg = {};

const paint = (el) => {
  const min = Number(el.min) || 0, max = Number(el.max) || 1;
  el.style.setProperty('--fill', (((el.value - min) / (max - min)) * 100 || 0) + '%');
};
const setStatus = (text, cls) => { $('statusText').textContent = text; $('status').className = 'pill' + (cls ? ' ' + cls : ''); };

let mode = 'token';
let coverTrack = '', coverUrl = '', coverTimer = null;

function showLogin(msg) {
  $('main').classList.add('hidden'); $('devicesCard').classList.add('hidden'); $('syncCard').classList.add('hidden');
  $('login').classList.remove('hidden'); $('logout').classList.add('hidden');
  $('loginMsg').textContent = msg || '';
}

async function loadCover(trackId, attempt = 0) {
  clearTimeout(coverTimer);
  if (!trackId) return hideCover();
  try {
    const headers = mode === 'token' ? { authorization: 'Bearer ' + store.get('token') } : {};
    const r = await fetch('/api/cover?track=' + encodeURIComponent(trackId), { headers, credentials: 'same-origin' });
    if (trackId !== coverTrack) return; // changed while loading
    if (r.ok) {
      const url = URL.createObjectURL(await r.blob());
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      coverUrl = url;
      $('cover').src = url; $('cover').classList.remove('hidden');
      return;
    }
  } catch { /* retry below */ }
  // The cover is uploaded a moment after the track starts; try a few times.
  if (attempt < 4) coverTimer = setTimeout(() => loadCover(trackId, attempt + 1), 1200);
}
function hideCover() { $('cover').classList.add('hidden'); $('cover').removeAttribute('src'); }

function connect() {
  const token = mode === 'token' ? ($('token').value || store.get('token')) : null;
  if (mode === 'token' && !token) return showLogin('');
  if (token) store.set('token', token);
  setStatus('Connecting…');
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  // Password mode: no token is sent; the login session cookie authenticates the page.
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', v: 1, token, deviceId, name: 'Phone remote', kind: 'web' }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') {
      retry = 0;
      $('login').classList.add('hidden'); $('main').classList.remove('hidden');
      $('logout').classList.toggle('hidden', mode !== 'password');
      setStatus('Connected', 'on');
      catalog = m.syncCatalog || []; syncCfg = m.syncConfig || {}; drawSync();
    }
    if (m.t === 'sync-config') { syncCfg = m.config || {}; drawSync(); }
    if (m.t === 'welcome' || m.t === 'devices') { devices = m.devices.filter((d) => d.kind !== 'web'); drawDevices(); }
    if (m.t === 'state' || (m.t === 'welcome' && m.state)) {
      state = m.state; stateAt = Date.now(); draw();
      if (state.trackId !== coverTrack) { coverTrack = state.trackId || ''; hideCover(); loadCover(coverTrack); }
    }
  };
  ws.onclose = (e) => {
    if (e.code === 4005) {
      setStatus(mode === 'password' ? 'Signed out' : 'Wrong token', 'bad');
      return showLogin(mode === 'password' ? 'Your session ended. Please sign in again.' : 'Wrong token.');
    }
    setStatus('Reconnecting…', 'bad');
    setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
  };
}

async function signIn() {
  $('loginMsg').textContent = '';
  if (mode === 'token') return connect();
  $('connect').disabled = true;
  try {
    const r = await fetch('/auth/login', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: $('user').value, password: $('pass').value }) });
    if (r.ok) { $('pass').value = ''; return connect(); }
    if (r.status === 429) {
      const { retryAfter } = await r.json().catch(() => ({}));
      $('loginMsg').textContent = 'Too many attempts. Try again in ' + Math.max(1, Math.ceil((retryAfter || 60) / 60)) + ' min.';
    } else {
      $('loginMsg').textContent = 'Wrong username or password.';
    }
  } catch { $('loginMsg').textContent = 'Could not reach the hub.'; }
  finally { $('connect').disabled = false; }
}

async function signOut() {
  try { await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch {}
  if (ws) { ws.onclose = null; ws.close(); }
  state = null; coverTrack = ''; hideCover();
  setStatus('Not connected');
  showLogin('Signed out.');
}

async function init() {
  try { mode = (await (await fetch('/auth/config')).json()).mode; } catch { /* keep token mode */ }
  $('pwForm').classList.toggle('hidden', mode !== 'password');
  $('tokenForm').classList.toggle('hidden', mode !== 'token');
  if (mode === 'password') {
    const me = await fetch('/auth/me', { credentials: 'same-origin' }).catch(() => null);
    if (me && me.ok) return connect();
    return showLogin('');
  }
  if (store.get('token')) { $('token').value = store.get('token'); return connect(); }
  showLogin('');
}

const ICON = {
  desktop: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6v2h3v2H7v-2h3v-2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v9h16V6H4z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm0 2v14h8V4H8zm4 15.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"/></svg>',
};
const activeDev = () => devices.find((d) => d.active);

function drawDevices() {
  const list = $('devices');
  list.replaceChildren();
  for (const d of devices) {
    const b = document.createElement('button');
    b.className = 'dev' + (d.active ? ' active' : '');
    b.innerHTML = (ICON[d.kind] || ICON.desktop) + '<span class="name"></span><span class="chip"></span>';
    b.querySelector('.name').textContent = d.name;
    b.querySelector('.chip').textContent = d.active ? 'Playing' : '';
    b.onclick = () => { if (!d.active && ws?.readyState === 1) ws.send(JSON.stringify({ t: 'transfer', to: d.id })); };
    list.appendChild(b);
  }
  $('devicesCard').classList.remove('hidden');
  $('noDevices').textContent = devices.length ? '' : 'No players connected. Open Psysonic on a device with the hub enabled.';
  const a = activeDev();
  const on = $('playingOn');
  on.textContent = a ? '▶ Playing on ' + a.name : (devices.length ? 'No active device. Pick one below.' : '');
  on.className = 'on-dev' + (a ? '' : ' none');
  $('main').classList.toggle('controls-off', !a);
}

function drawSync() {
  const list = $('syncList');
  list.replaceChildren();
  for (const c of catalog) {
    const row = document.createElement('label');
    row.className = 'sync-row';
    row.innerHTML = '<span class="t"><span class="n"></span><div class="d"></div></span><input type="checkbox" class="switch">';
    row.querySelector('.n').textContent = c.label;
    row.querySelector('.d').textContent = c.desc;
    const box = row.querySelector('input');
    box.checked = syncCfg[c.id] === true;
    box.onchange = () => { if (ws?.readyState === 1) ws.send(JSON.stringify({ t: 'sync-config', category: c.id, enabled: box.checked })); };
    list.appendChild(row);
  }
  $('syncCard').classList.toggle('hidden', catalog.length === 0);
}

const cmd = (action, args) => { const to = activeDev()?.id; if (to && ws?.readyState === 1) ws.send(JSON.stringify({ t: 'command', to, action, args })); };
const nowPos = () => state ? (state.positionSec || 0) + (state.playing ? (Date.now() - stateAt) / 1000 : 0) : 0;

function draw() {
  if (!state) return;
  $('title').textContent = state.title || 'Nothing playing';
  $('artist').textContent = [state.artist, state.album].filter(Boolean).join(' · ') || '\u00a0';
  $('icoPlay').classList.toggle('hidden', !!state.playing);
  $('icoPause').classList.toggle('hidden', !state.playing);
  $('seek').max = state.durationSec || 1;
  $('dur').textContent = fmt(state.durationSec);
  if (!volDragging && typeof state.volume === 'number') { $('vol').value = state.volume; paint($('vol')); }
}
setInterval(() => {
  if (state && !dragging) { const p = Math.min(nowPos(), state.durationSec || nowPos()); $('seek').value = p; $('pos').textContent = fmt(p); paint($('seek')); }
}, 250);

$('loginForm').addEventListener('submit', (e) => { e.preventDefault(); signIn(); });
$('logout').onclick = signOut;
$('toggle').onclick = () => cmd('toggle');
$('prev').onclick = () => cmd('prev');
$('next').onclick = () => cmd('next');
$('seek').oninput = () => { dragging = true; $('pos').textContent = fmt($('seek').value); paint($('seek')); };
$('seek').onchange = () => {
  cmd('seek', { positionSec: Number($('seek').value) });
  if (state) { state.positionSec = Number($('seek').value); stateAt = Date.now(); }
  dragging = false;
};
$('vol').oninput = () => { volDragging = true; paint($('vol')); cmd('volume', { volume: Number($('vol').value) }); };
$('vol').onchange = () => { volDragging = false; };
paint($('seek')); paint($('vol'));
init();
