const $ = (id) => document.getElementById(id);
const fmt = (s) => {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

const store = {
  get: (k) => {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set: (k, v) => {
    try { localStorage.setItem(k, v); } catch {}
  }
};

const fallbackTranslations = {
  'app.remote': 'Remote',
  'status.notConnected': 'Not connected',
  'status.connecting': 'Connecting…',
  'status.connected': 'Connected',
  'status.reconnecting': 'Reconnecting…',
  'status.lockedOut': 'Locked out',
  'status.tooManyConnections': 'Too many connections',
  'status.signedOut': 'Signed out',
  'status.wrongToken': 'Wrong token',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.hubToken': 'Hub token',
  'login.signIn': 'Sign in',
  'login.signOut': 'Sign out',
  'login.tooManyAttempts': 'Too many attempts. Try again in {{minutes}} min.',
  'login.wrongCredentials': 'Wrong username or password.',
  'login.unreachable': 'Could not reach the hub.',
  'login.sessionEnded': 'Your session ended. Please sign in again.',
  'login.wrongToken': 'Wrong token.',
  'login.signedOut': 'Signed out.',
  'devices.playOn': 'Play on',
  'devices.playing': 'Playing',
  'devices.none': 'No players connected. Open Psysonic on a device with the hub enabled.',
  'devices.noActive': 'No active device. Pick one below.',
  'devices.playingOn': 'Playing on {{name}}',
  'player.nothingPlaying': 'Nothing playing',
  'player.seek': 'Seek',
  'player.previous': 'Previous track',
  'player.toggle': 'Play or pause',
  'player.next': 'Next track',
  'player.volume': 'Volume',
  'settings.sync': 'Settings sync',
  'settings.syncIntro': 'Choose what is kept identical on all your devices. Changes apply to every device.',
  'footer': 'Self-hosted · your music, your devices',
  'language.label': 'Language',
  'language.en': 'English',
  'sync.playback.label': 'Playback',
  'sync.playback.desc': 'Crossfade, AutoDJ, gapless, fades, infinite queue and shuffle behaviour',
  'sync.loudness.label': 'Volume normalization',
  'sync.loudness.desc': 'ReplayGain and loudness settings, so every device sounds equally loud',
  'sync.lyrics.label': 'Lyrics',
  'sync.lyrics.desc': 'Lyrics sources and display options',
  'sync.appearance.label': 'Appearance',
  'sync.appearance.desc': 'Theme and display options, fullscreen player and seekbar style',
  'sync.eq.label': 'Equalizer',
  'sync.eq.desc': 'Bands, pre-gain and custom equalizer presets',
  'sync.keybindings.label': 'In-app keybindings',
  'sync.keybindings.desc': 'Keyboard shortcuts inside the app'
};

let currentLocale = store.get('locale') || 'en';
let translations = { ...fallbackTranslations };
let localeRequestId = 0;

async function loadLocale(locale) {
  const requestId = ++localeRequestId;

  async function fetchLocale(targetLocale) {
    const response = await fetch(`/locales/${targetLocale}.json`);
    if (!response.ok) throw new Error(`Locale not found: ${targetLocale}`);
    return response.json();
  }

  try {
    let loadedTranslations;

    try {
      loadedTranslations = await fetchLocale(locale);
    } catch (error) {
      console.error('Could not load locale:', locale, error);

      if (locale === 'en') throw error;

      loadedTranslations = await fetchLocale('en');
      locale = 'en';
    }

    // Ignore responses from older language selections.
    if (requestId !== localeRequestId) return false;

    translations = { ...fallbackTranslations, ...loadedTranslations };
    currentLocale = locale;
    store.set('locale', locale);

    return true;
  } catch (error) {
    console.error('Could not load English fallback:', error);

    // Keep the built-in English dictionary if even English cannot be fetched.
    if (requestId !== localeRequestId) return false;

    translations = { ...fallbackTranslations };
    currentLocale = 'en';
    store.set('locale', 'en');

    return true;
  }
}

function t(key, replacements = {}) {
  let value = translations[key] ?? fallbackTranslations[key] ?? key;

  for (const [name, replacement] of Object.entries(replacements)) {
    value = value.replaceAll(`{{${name}}}`, String(replacement));
  }

  return value;
}

let statusKey = 'status.notConnected';
let statusClass = '';

function setStatus(key, cls = '') {
  statusKey = key;
  statusClass = cls;
  $('statusText').textContent = t(statusKey);
  $('status').className = 'pill' + (statusClass ? ' ' + statusClass : '');
}

function applyTranslations() {
  document.documentElement.lang = currentLocale;

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    // These elements are controlled by runtime state, not static translations.
    if (element.id === 'statusText' || element.id === 'title') return;

    element.textContent = t(element.dataset.i18n);
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });

  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });

  // Re-render the current runtime status and player state in the new language.
  setStatus(statusKey, statusClass);

  if (state) {
    draw();
  } else {
    $('title').textContent = t('player.nothingPlaying');
  }
}

const deviceId = store.get('deviceId') || ('web-' + Math.random().toString(36).slice(2, 12));
store.set('deviceId', deviceId);

// Logo: only shown if /logo.svg exists; otherwise the text brand stays.
const probe = new Image();
probe.onload = () => {
  $('logo').classList.add('ok');
  $('brandName').classList.add('hidden');
};
probe.src = '/logo.svg';

let ws, devices = [], state = null, stateAt = 0, retry = 0, dragging = false, volDragging = false;
let catalog = [], syncCfg = {};

const paint = (el) => {
  const min = Number(el.min) || 0, max = Number(el.max) || 1;
  el.style.setProperty('--fill', (((el.value - min) / (max - min)) * 100 || 0) + '%');
};

let mode = 'token';
let coverTrack = '', coverUrl = '', coverTimer = null;

function showLogin(msg) {
  $('main').classList.add('hidden');
  $('devicesCard').classList.add('hidden');
  $('syncCard').classList.add('hidden');
  $('login').classList.remove('hidden');
  $('logout').classList.add('hidden');
  $('loginMsg').textContent = msg || '';
}

async function loadCover(trackId, attempt = 0) {
  clearTimeout(coverTimer);
  if (!trackId) return hideCover();

  try {
    const headers = mode === 'token' ? { authorization: 'Bearer ' + store.get('token') } : {};
    const r = await fetch('/api/cover?track=' + encodeURIComponent(trackId), {
      headers,
      credentials: 'same-origin'
    });

    if (trackId !== coverTrack) return;

    if (r.ok) {
      const url = URL.createObjectURL(await r.blob());
      if (coverUrl) URL.revokeObjectURL(coverUrl);
      coverUrl = url;
      $('cover').src = url;
      $('cover').classList.remove('hidden');
      return;
    }
  } catch {
    /* retry below */
  }

  // The cover is uploaded a moment after the track starts; try a few times.
  if (attempt < 4) {
    coverTimer = setTimeout(() => loadCover(trackId, attempt + 1), 1200);
  }
}

function hideCover() {
  $('cover').classList.add('hidden');
  $('cover').removeAttribute('src');
}

function connect() {
  const token = mode === 'token' ? ($('token').value || store.get('token')) : null;
  if (mode === 'token' && !token) return showLogin('');
  if (token) store.set('token', token);

  setStatus('status.connecting');

  ws = new WebSocket(
    (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'
  );

  // Password mode: no token is sent; the login session cookie authenticates the page.
  ws.onopen = () => ws.send(JSON.stringify({
    t: 'hello',
    v: 1,
    token,
    deviceId,
    name: 'psysonic-hub',
    kind: 'web'
  }));

  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);

    if (m.t === 'welcome') {
      retry = 0;
      $('login').classList.add('hidden');
      $('main').classList.remove('hidden');
      $('logout').classList.toggle('hidden', mode !== 'password');
      setStatus('status.connected', 'on');

      catalog = m.syncCatalog || [];
      syncCfg = m.syncConfig || {};
      drawSync();
    }

    if (m.t === 'sync-config') {
      syncCfg = m.config || {};
      drawSync();
    }

    if (m.t === 'welcome' || m.t === 'devices') {
      devices = m.devices.filter((d) => d.kind !== 'web');
      drawDevices();
    }

    if (m.t === 'state' || (m.t === 'welcome' && m.state)) {
      state = m.state;
      stateAt = Date.now();
      draw();

      if (state.trackId !== coverTrack) {
        coverTrack = state.trackId || '';
        hideCover();
        loadCover(coverTrack);
      }
    }
  };

  ws.onclose = (e) => {
    // The hub refuses this address for now: stop retrying.
    if (e.code === 4011 || e.code === 4010) {
      setStatus(
        e.code === 4011 ? 'status.lockedOut' : 'status.tooManyConnections',
        'bad'
      );

      return showLogin(e.code === 4011
        ? 'Too many failed attempts from this address. Try again in a few minutes.'
        : 'Too many connections from this address. Close other tabs and try again.');
    }

    if (e.code === 4005) {
      setStatus(
        mode === 'password' ? 'status.signedOut' : 'status.wrongToken',
        'bad'
      );

      return showLogin(
        mode === 'password'
          ? t('login.sessionEnded')
          : t('login.wrongToken')
      );
    }

    setStatus('status.reconnecting', 'bad');
    setTimeout(connect, Math.min(1000 * 2 ** retry++, 15000));
  };
}

async function signIn() {
  $('loginMsg').textContent = '';

  if (mode === 'token') return connect();

  $('connect').disabled = true;

  try {
    const r = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user: $('user').value,
        password: $('pass').value
      })
    });

    if (r.ok) {
      $('pass').value = '';
      return connect();
    }

    if (r.status === 429) {
      const { retryAfter } = await r.json().catch(() => ({}));
      $('loginMsg').textContent = t('login.tooManyAttempts', {
        minutes: Math.max(1, Math.ceil((retryAfter || 60) / 60))
      });
    } else {
      $('loginMsg').textContent = t('login.wrongCredentials');
    }
  } catch {
    $('loginMsg').textContent = t('login.unreachable');
  } finally {
    $('connect').disabled = false;
  }
}

async function signOut() {
  try {
    const response = await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error('Logout failed');
    }
  } catch (error) {
    console.error('Sign out failed:', error);
    $('loginMsg').textContent = 'Could not sign out. Please try again.';
    return;
  }

  if (ws) {
    ws.onclose = null;
    ws.close();
  }

  state = null;
  coverTrack = '';
  hideCover();
  setStatus('status.notConnected');
  showLogin(t('login.signedOut'));
}

async function init() {
  try {
    mode = (await (await fetch('/auth/config')).json()).mode;
  } catch {
    /* keep token mode */
  }

  $('pwForm').classList.toggle('hidden', mode !== 'password');
  $('tokenForm').classList.toggle('hidden', mode !== 'token');

  if (mode === 'password') {
    const me = await fetch('/auth/me', {
      credentials: 'same-origin'
    }).catch(() => null);

    if (me && me.ok) return connect();
    return showLogin('');
  }

  if (store.get('token')) {
    $('token').value = store.get('token');
    return connect();
  }

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
    b.querySelector('.chip').textContent = d.active ? t('devices.playing') : '';

    b.onclick = () => {
      if (!d.active && ws?.readyState === 1) {
        ws.send(JSON.stringify({ t: 'transfer', to: d.id }));
      }
    };

    list.appendChild(b);
  }

  $('devicesCard').classList.remove('hidden');
  $('noDevices').textContent = devices.length ? '' : t('devices.none');

  const a = activeDev();
  const on = $('playingOn');

  on.textContent = a
    ? t('devices.playingOn', { name: a.name })
    : (devices.length ? t('devices.noActive') : '');

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

    row.querySelector('.n').textContent = t(`sync.${c.id}.label`);
    row.querySelector('.d').textContent = t(`sync.${c.id}.desc`);

    const box = row.querySelector('input');
    box.checked = syncCfg[c.id] === true;

    box.onchange = () => {
      if (ws?.readyState === 1) {
        ws.send(JSON.stringify({
          t: 'sync-config',
          category: c.id,
          enabled: box.checked
        }));
      }
    };

    list.appendChild(row);
  }

  $('syncCard').classList.toggle('hidden', catalog.length === 0);
}

const cmd = (action, args) => {
  const to = activeDev()?.id;
  if (to && ws?.readyState === 1) {
    ws.send(JSON.stringify({ t: 'command', to, action, args }));
  }
};

const nowPos = () => state
  ? (state.positionSec || 0) + (state.playing ? (Date.now() - stateAt) / 1000 : 0)
  : 0;

function draw() {
  if (!state) return;

  $('title').textContent = state.title || t('player.nothingPlaying');
  $('artist').textContent = [state.artist, state.album].filter(Boolean).join(' · ') || '\u00a0';
  $('icoPlay').classList.toggle('hidden', !!state.playing);
  $('icoPause').classList.toggle('hidden', !state.playing);
  $('seek').max = state.durationSec || 1;
  $('dur').textContent = fmt(state.durationSec);

  if (!volDragging && typeof state.volume === 'number') {
    $('vol').value = state.volume;
    paint($('vol'));
  }
}

setInterval(() => {
  if (state && !dragging) {
    const p = Math.min(nowPos(), state.durationSec || nowPos());
    $('seek').value = p;
    $('pos').textContent = fmt(p);
    paint($('seek'));
  }
}, 250);

$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  signIn();
});

$('logout').onclick = signOut;
$('toggle').onclick = () => cmd('toggle');
$('prev').onclick = () => cmd('prev');
$('next').onclick = () => cmd('next');

$('seek').oninput = () => {
  dragging = true;
  $('pos').textContent = fmt($('seek').value);
  paint($('seek'));
};

$('seek').onchange = () => {
  cmd('seek', { positionSec: Number($('seek').value) });

  if (state) {
    state.positionSec = Number($('seek').value);
    stateAt = Date.now();
  }

  dragging = false;
};

// While dragging, send at most one volume command per 100 ms.
let volTimer = null;
let volSentAt = 0;

const sendVolume = () => {
  clearTimeout(volTimer);
  volTimer = null;
  volSentAt = Date.now();
  cmd('volume', { volume: Number($('vol').value) });
};

$('vol').oninput = () => {
  volDragging = true;
  paint($('vol'));

  if (!volTimer) {
    volTimer = setTimeout(
      sendVolume,
      Math.max(0, 100 - (Date.now() - volSentAt))
    );
  }
};

$('vol').onchange = () => {
  sendVolume();
  volDragging = false;
};

paint($('seek'));
paint($('vol'));

// Remember whether the Settings sync card is collapsed (per browser).
const SYNC_OPEN_KEY = 'psysonic-hub:syncOpen';
{
  const card = $('syncCard');
  const saved = store.get(SYNC_OPEN_KEY);
  if (saved === '0') card.open = false;
  else if (saved === '1') card.open = true;
  card.addEventListener('toggle', () => store.set(SYNC_OPEN_KEY, card.open ? '1' : '0'));
}

async function start() {
  const languageSelect = $('language');

  await loadLocale(currentLocale);
  applyTranslations();

  if (languageSelect) {
    languageSelect.value = currentLocale;

    languageSelect.addEventListener('change', async () => {
      const requestedLocale = languageSelect.value;
      const loaded = await loadLocale(requestedLocale);

      // A newer selection may have happened while this one was loading.
      if (!loaded) return;

      languageSelect.value = currentLocale;
      applyTranslations();

      if (ws?.readyState === 1) {
        drawDevices();
        drawSync();
        draw();
      }
    });
  }

  await init();
}

start();

// Installed web app: keeps the page available while the hub is unreachable (needs https or localhost).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
