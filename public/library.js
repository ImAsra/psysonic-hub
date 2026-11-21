// Queue and library for the web remote. Loaded after app.js and uses its globals
// (ws, devices, activeDev, cmd, t, store, mode, fmt, $).
// The hub never talks to the music server: library pages and artwork are looked up by a
// connected player and relayed by the hub.

let queues = {}; // device id -> { index, offset, total, tracks }
let libView = null; // current library view: { kind, req, title, sub, coverArt, id, items }
const libStack = [];
let libTab = store.get('libTab') || 'albums';
let albumSort = store.get('albumSort') || 'newest';
let libOffset = 0;
let libLoadedFor = '';
let ridSeq = 0;
const browseWaiters = new Map();

// The player that answers library lookups and plays what is picked: the active one, else the first.
const libraryPlayer = () => activeDev() ?? devices[0] ?? null;

// ---------------------------------------------------------------------------
// messages (called from app.js)
// ---------------------------------------------------------------------------
function onLibraryMessage(m) {
  if (m.t === 'welcome') {
    queues = m.queues || {};
    drawQueue();
    refreshLibraryCard();
  }
  if (m.t === 'devices') {
    for (const id of Object.keys(queues)) if (!devices.some((d) => d.id === id)) delete queues[id];
    drawQueue();
    refreshLibraryCard();
  }
  if (m.t === 'queue') {
    queues[m.from] = m.queue;
    if (m.from === activeDev()?.id) drawQueue();
  }
  if (m.t === 'browse-result') {
    const w = browseWaiters.get(m.rid);
    if (w) {
      browseWaiters.delete(m.rid);
      w(m);
    }
  }
}

function hideLibraryCards() {
  $('queueCard').classList.add('hidden');
  $('libraryCard').classList.add('hidden');
}

// ---------------------------------------------------------------------------
// artwork: fetched lazily (token mode needs the Authorization header, so no plain <img src>)
// ---------------------------------------------------------------------------
const artUrls = new Map(); // "size:coverArt" -> object URL
const artObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      artObserver.unobserve(e.target);
      loadArt(e.target);
    }
  }, { rootMargin: '200px' })
  : null;

function art(img, coverArt, size) {
  img.alt = '';
  if (!coverArt) return;
  img.dataset.art = coverArt;
  img.dataset.size = String(size);
  const known = artUrls.get(size + ':' + coverArt);
  if (known) img.src = known;
  else if (artObserver) artObserver.observe(img);
  else loadArt(img);
}

async function loadArt(img) {
  const key = img.dataset.size + ':' + img.dataset.art;
  if (artUrls.has(key)) {
    img.src = artUrls.get(key);
    return;
  }
  try {
    const headers = mode === 'token' ? { authorization: 'Bearer ' + store.get('token') } : {};
    const r = await fetch('/api/art?id=' + encodeURIComponent(img.dataset.art) + '&size=' + img.dataset.size, {
      headers, credentials: 'same-origin',
    });
    if (!r.ok) return;
    const url = URL.createObjectURL(await r.blob());
    artUrls.set(key, url);
    if (img.dataset.size + ':' + img.dataset.art === key) img.src = url;
  } catch { /* no artwork is fine */ }
}

// ---------------------------------------------------------------------------
// shared row / tile builders (text only through textContent)
// ---------------------------------------------------------------------------
function row({ num, l1, l2, dur, coverArt, round, cls, onClick, onAdd }) {
  const b = document.createElement('div');
  b.className = 'row' + (cls ? ' ' + cls : '');
  b.setAttribute('role', 'button');
  b.tabIndex = 0;
  if (num !== undefined) {
    const n = document.createElement('span');
    n.className = 'num';
    n.textContent = num;
    b.appendChild(n);
  }
  if (coverArt !== undefined) {
    const img = document.createElement('img');
    img.className = 'thumb' + (round ? ' round' : '');
    art(img, coverArt, 96);
    b.appendChild(img);
  }
  const txt = document.createElement('span');
  txt.className = 'txt';
  const a = document.createElement('div');
  a.className = 'l1';
  a.textContent = l1 || '—';
  txt.appendChild(a);
  if (l2) {
    const s = document.createElement('div');
    s.className = 'l2';
    s.textContent = l2;
    txt.appendChild(s);
  }
  b.appendChild(txt);
  if (dur) {
    const d = document.createElement('span');
    d.className = 'dur';
    d.textContent = fmt(dur);
    b.appendChild(d);
  }
  if (onAdd) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add';
    add.textContent = '+';
    add.setAttribute('aria-label', t('library.addToQueue'));
    add.onclick = (e) => { e.stopPropagation(); onAdd(); };
    b.appendChild(add);
  }
  b.onclick = onClick;
  b.onkeydown = (e) => {
    if (e.target !== e.currentTarget) return; // a key on the + button belongs to that button
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
  };
  return b;
}

function tile({ l1, l2, coverArt, onClick }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tile';
  const img = document.createElement('img');
  img.className = 'sq';
  art(img, coverArt, 300);
  const a = document.createElement('div');
  a.className = 'l1';
  a.textContent = l1 || '—';
  const s = document.createElement('div');
  s.className = 'l2';
  s.textContent = l2 || ' ';
  b.append(img, a, s);
  b.onclick = onClick;
  return b;
}

const section = (label) => {
  const h = document.createElement('div');
  h.className = 'lib-section';
  h.textContent = label;
  return h;
};

// ---------------------------------------------------------------------------
// queue
// ---------------------------------------------------------------------------
function drawQueue() {
  const a = activeDev();
  const q = a && queues[a.id];
  const card = $('queueCard');
  if (!q || !q.tracks?.length || ws?.readyState !== 1) return card.classList.add('hidden');
  card.classList.remove('hidden');
  const list = $('queueList');
  list.replaceChildren();
  let current = null;
  q.tracks.forEach((tr, i) => {
    const abs = q.offset + i;
    const el = row({
      num: abs + 1,
      l1: tr.title,
      l2: [tr.artist, tr.album].filter(Boolean).join(' · '),
      dur: tr.durationSec,
      cls: abs === q.index ? 'current' : (abs < q.index ? 'played' : ''),
      onClick: () => cmd('playIndex', { index: abs, trackId: tr.id }),
    });
    if (abs === q.index) current = el;
    list.appendChild(el);
  });
  const rest = q.total - (q.offset + q.tracks.length);
  $('queueMore').textContent = rest > 0 ? t('queue.more', { count: rest }) : '';
  // Keep the current track near the top of the list.
  if (current) list.scrollTop = Math.max(0, current.offsetTop - list.offsetTop - 8);
}

// ---------------------------------------------------------------------------
// library
// ---------------------------------------------------------------------------
function browse(req) {
  return new Promise((resolve) => {
    const to = libraryPlayer()?.id;
    if (!to || ws?.readyState !== 1) return resolve({ error: 'no_player' });
    const rid = 'r' + (++ridSeq) + '-' + Math.random().toString(36).slice(2, 8);
    browseWaiters.set(rid, resolve);
    ws.send(JSON.stringify({ t: 'browse', to, rid, req }));
    setTimeout(() => {
      if (browseWaiters.delete(rid)) resolve({ error: 'timeout' });
    }, 20000);
  });
}

function playItem(kind, id, mode, index) {
  const to = libraryPlayer()?.id;
  if (!to || ws?.readyState !== 1) return;
  ws.send(JSON.stringify({ t: 'command', to, action: 'playItem', args: { kind, id, mode, index } }));
}

function refreshLibraryCard() {
  const card = $('libraryCard');
  const player = libraryPlayer();
  if (!player || ws?.readyState !== 1) return card.classList.add('hidden');
  card.classList.remove('hidden');
  // First time, or the player that answers changed: load the top level again.
  if (libLoadedFor !== player.id) {
    libLoadedFor = player.id;
    libStack.length = 0;
    libView = null;
    showTab(libTab);
  }
}

function setViewClass(name) {
  const card = $('libraryCard');
  card.classList.remove('libview-albums', 'libview-artists', 'libview-playlists', 'libview-search', 'libview-detail');
  card.classList.add('libview-' + name);
}

function markChips() {
  for (const b of $('libTabs').children) b.classList.toggle('on', b.dataset.tab === libTab);
  for (const b of $('albumSorts').children) b.classList.toggle('on', b.dataset.sort === albumSort);
}

function setMsg(key, extra) {
  $('libMsg').textContent = key ? t(key, extra) : '';
}

function errorKey(r) {
  return r.error === 'no_player' ? 'library.noPlayer' : r.error === 'timeout' ? 'library.timeout' : 'library.failed';
}

// Every navigation (tab, sort, detail, search, player change) gets a number; an answer that comes back
// after the user moved on belongs to an older one and is dropped.
let navGen = 0;
let loadingMore = false;

async function showTab(tab) {
  navGen++;
  loadingMore = false;
  $('libMore').disabled = false;
  libTab = tab;
  store.set('libTab', tab);
  libStack.length = 0;
  libOffset = 0;
  $('search').value = '';
  $('libHead').classList.add('hidden');
  setViewClass(tab);
  markChips();
  $('libBody').replaceChildren();
  $('libMore').classList.add('hidden');
  await loadPage(false);
}

async function loadPage(append) {
  if (append && loadingMore) return; // one page at a time, or two would load the same offset
  const gen = navGen;
  const req = libTab === 'albums'
    ? { kind: 'albums', sort: albumSort, offset: libOffset }
    : libTab === 'artists' ? { kind: 'artists', offset: libOffset } : { kind: 'playlists' };
  if (append) {
    loadingMore = true;
    $('libMore').disabled = true;
  }
  setMsg('library.loading');
  const r = await browse(req);
  if (gen !== navGen) return; // the user moved on meanwhile
  if (append) {
    loadingMore = false;
    $('libMore').disabled = false;
  }
  if (r.error) return setMsg(errorKey(r));
  setMsg('');
  const body = $('libBody');
  if (!append) body.replaceChildren();
  const res = r.result || {};
  if (libTab === 'albums') appendAlbumGrid(body, res.albums || [], append);
  if (libTab === 'artists') appendArtistRows(body, res.artists || [], append);
  if (libTab === 'playlists') appendPlaylistRows(body, res.playlists || []);
  const count = (res.albums || res.artists || res.playlists || []).length;
  if (!count && !append) setMsg('library.empty');
  libOffset += count;
  $('libMore').classList.toggle('hidden', !res.more);
}
const tabOf = (req) => (req.kind === 'albums' ? 'albums' : req.kind === 'artists' ? 'artists' : 'playlists');

function appendAlbumGrid(body, albums, append) {
  let grid = append ? body.querySelector('.grid:last-of-type') : null;
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'grid';
    body.appendChild(grid);
  }
  for (const a of albums) {
    grid.appendChild(tile({
      l1: a.name, l2: [a.artist, a.year].filter(Boolean).join(' · '), coverArt: a.coverArt,
      onClick: () => openDetail({ kind: 'album', id: a.id }),
    }));
  }
}

function appendArtistRows(body, artists, append) {
  let rows = append ? body.querySelector('.rows:last-of-type') : null;
  if (!rows) {
    rows = document.createElement('div');
    rows.className = 'rows flat';
    body.appendChild(rows);
  }
  for (const a of artists) {
    rows.appendChild(row({
      l1: a.name, l2: a.albumCount ? t('library.albumCount', { count: a.albumCount }) : '', coverArt: a.coverArt, round: true,
      onClick: () => openDetail({ kind: 'artist', id: a.id }),
    }));
  }
}

function appendPlaylistRows(body, playlists) {
  const rows = document.createElement('div');
  rows.className = 'rows flat';
  for (const p of playlists) {
    rows.appendChild(row({
      l1: p.name, l2: p.songCount ? t('library.songCount', { count: p.songCount }) : '', coverArt: p.coverArt,
      onClick: () => openDetail({ kind: 'playlist', id: p.id }),
    }));
  }
  body.appendChild(rows);
}

function songRows(songs, onPlay, withAlbum) {
  const rows = document.createElement('div');
  rows.className = 'rows flat';
  songs.forEach((s, i) => {
    rows.appendChild(row({
      num: withAlbum ? undefined : (s.track || i + 1),
      coverArt: withAlbum ? s.coverArt : undefined,
      l1: s.title,
      l2: withAlbum ? [s.artist, s.album].filter(Boolean).join(' · ') : s.artist,
      dur: s.durationSec,
      onClick: () => onPlay(s, i),
      onAdd: () => playItem('song', s.id, 'add'),
    }));
  });
  return rows;
}

async function openDetail(req, fromBack = false) {
  const gen = ++navGen;
  if (!fromBack && libView) libStack.push(libView);
  libView = { ...req };
  setViewClass('detail');
  $('libHead').classList.remove('hidden');
  $('libMore').classList.add('hidden');
  $('libActions').classList.toggle('hidden', req.kind === 'artist');
  $('libTitle').textContent = '';
  $('libSub').textContent = '';
  $('libArt').classList.add('hidden');
  $('libBody').replaceChildren();
  setMsg('library.loading');
  const r = await browse(req);
  if (gen !== navGen) return; // the user moved on meanwhile
  if (r.error) return setMsg(errorKey(r));
  setMsg('');
  const res = r.result || {};
  const it = res.item || {};
  $('libTitle').textContent = it.name || it.title || '';
  $('libSub').textContent = req.kind === 'album'
    ? [it.artist, it.year].filter(Boolean).join(' · ')
    : req.kind === 'playlist' && it.songCount ? t('library.songCount', { count: it.songCount }) : '';
  if (it.coverArt) {
    $('libArt').classList.remove('hidden');
    art($('libArt'), it.coverArt, 300);
  }
  const body = $('libBody');
  if (req.kind === 'artist') appendAlbumGrid(body, res.albums || [], false);
  else body.appendChild(songRows(res.songs || [], (s, i) => playItem(req.kind, req.id, 'play', i), req.kind === 'playlist'));
}

async function runSearch(query) {
  const gen = ++navGen;
  libStack.length = 0;
  libView = { kind: 'search', id: query };
  setViewClass('search');
  $('libHead').classList.add('hidden');
  $('libMore').classList.add('hidden');
  $('libBody').replaceChildren();
  setMsg('library.loading');
  const r = await browse({ kind: 'search', query });
  if (gen !== navGen) return;
  if (r.error) return setMsg(errorKey(r));
  const res = r.result || {};
  const body = $('libBody');
  const none = !res.artists?.length && !res.albums?.length && !res.songs?.length;
  setMsg(none ? 'library.noResults' : '');
  if (res.songs?.length) {
    body.appendChild(section(t('library.songs')));
    body.appendChild(songRows(res.songs, (s) => playItem('song', s.id, 'play'), true));
  }
  if (res.albums?.length) {
    body.appendChild(section(t('library.albums')));
    appendAlbumGrid(body, res.albums, false);
  }
  if (res.artists?.length) {
    body.appendChild(section(t('library.artists')));
    appendArtistRows(body, res.artists, false);
  }
}

function goBack() {
  const prev = libStack.pop();
  libView = null;
  if (prev && prev.kind !== 'search') return openDetail(prev, true);
  if (prev?.kind === 'search') {
    $('search').value = prev.id;
    return runSearch(prev.id);
  }
  return showTab(libTab);
}

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------
for (const b of $('libTabs').children) b.onclick = () => { libView = null; showTab(b.dataset.tab); };
for (const b of $('albumSorts').children) {
  b.onclick = () => {
    albumSort = b.dataset.sort;
    store.set('albumSort', albumSort);
    libView = null;
    showTab('albums');
  };
}
for (const b of $('libActions').children) b.onclick = () => libView && playItem(libView.kind, libView.id, b.dataset.mode);
$('libBack').onclick = goBack;
$('libMore').onclick = () => loadPage(true);
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('search').value.trim();
  $('search').blur();
  if (q) runSearch(q);
  else { libView = null; showTab(libTab); }
});
