// Tests for the web login, the REST API, the event stream and cover art.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const TOKEN = 'device-token-1234567890';
const USER = 'asra';
const PASS = 'correct-horse-battery';
const API_FULL = 'api-full-token-abcdefghijkl';
const API_READ = 'api-read-token-abcdefghijkl';

async function startHub(port, env = {}) {
  const srv = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(port), HUB_TOKEN: TOKEN, HUB_DATA_DIR: '', ...env },
  });
  await new Promise((r) => srv.stdout.once('data', r));
  return srv;
}
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.t === t);

function connect(port, deviceId, name, kind, { token = TOKEN, headers = {}, hello = true } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  ws.inbox = [];
  ws.closeCode = null;
  ws.on('message', (d) => ws.inbox.push(JSON.parse(d)));
  ws.on('close', (c) => (ws.closeCode = c));
  ws.on('error', () => {});
  if (hello) ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token, deviceId, name, kind })));
  return ws;
}

// ================= main server: password login + API tokens =================
const PORT = 5596;
const srv = await startHub(PORT, {
  HUB_USER: USER, HUB_PASSWORD: PASS, API_TOKEN: API_FULL, API_TOKEN_READONLY: API_READ,
  HUB_PUBLIC_URL: 'http://hub.test',
});
const base = `http://127.0.0.1:${PORT}`;
const get = (path, headers = {}) => fetch(base + path, { headers });
const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
const bearer = (t) => ({ authorization: `Bearer ${t}` });

try {
  // ---- web login ----
  assert.equal((await (await get('/auth/config')).json()).mode, 'password');
  assert.equal((await get('/auth/me')).status, 401);
  assert.equal((await post('/auth/login', { user: USER, password: 'wrong-password-1' })).status, 401);
  assert.equal((await post('/auth/login', { user: 'someone', password: PASS })).status, 401);
  const ok = await post('/auth/login', { user: USER, password: PASS });
  assert.equal(ok.status, 200);
  const setCookie = ok.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await get('/auth/me', { cookie })).status, 200);

  // ---- websocket auth: cookie works, wrong origin / nothing does not ----
  const web = connect(PORT, 'web-page-0001', 'Phone remote', 'desktop', { token: null, headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
  await wait();
  assert.ok(last(web, 'welcome'), 'session cookie logs the page in');
  assert.equal(last(web, 'welcome').devices.find((d) => d.id === 'web-page-0001').kind, 'web', 'session logins are always web remotes');

  const evil = connect(PORT, 'evil-0001', 'Evil', 'desktop', { token: null, headers: { cookie, origin: 'http://evil.example' } });
  await wait();
  assert.equal(evil.closeCode, 4005, 'cross-site WebSocket with a valid cookie is refused');

  const anon = connect(PORT, 'anon-0001', 'Anon', 'desktop', { token: null });
  await wait();
  assert.equal(anon.closeCode, 4005);

  // ---- API auth levels ----
  assert.equal((await get('/api/state')).status, 401);
  assert.equal((await get('/api/state', bearer('nope-nope-nope'))).status, 401);
  assert.equal((await get('/api/state', bearer(API_READ))).status, 200);
  assert.equal((await get(`/api/state?key=${API_READ}`)).status, 200, 'read-only key may travel in the query');
  assert.equal((await get(`/api/state?key=${API_FULL}`)).status, 401, 'the full token must never work from a URL');
  assert.equal((await get('/api/state', { cookie })).status, 200, 'web session may read');
  assert.equal((await get('/api/state', bearer(TOKEN))).status, 200, 'hub token may read');
  assert.equal((await post('/api/pause', {}, bearer(API_READ))).status, 403);
  assert.equal((await post('/api/pause', {}, bearer(TOKEN))).status, 403);
  assert.equal((await post('/api/pause', {}, { cookie })).status, 403, 'a session cannot control through /api');

  // ---- no active device yet ----
  assert.equal((await post('/api/pause', {}, bearer(API_FULL))).status, 409);

  // ---- players ----
  const desk = connect(PORT, 'desk-api-0001', 'Desktop', 'desktop');
  const laptop = connect(PORT, 'lap-api-0001', 'Laptop', 'desktop');
  await wait();
  desk.send(JSON.stringify({ t: 'state', state: {
    trackId: 'song1', title: 'Song', artist: 'Band', album: 'Album', durationSec: 200,
    positionSec: 50, playing: true, volume: 0.5, shuffle: false, repeat: 'off',
  } }));
  await wait();

  const st = await (await get('/api/state', bearer(API_READ))).json();
  assert.equal(st.active_device.name, 'Desktop');
  assert.equal(st.playing, true);
  assert.equal(st.track.title, 'Song');
  assert.equal(st.track.duration_sec, 200);
  assert.ok(st.position_sec >= 50 && st.position_sec < 53);
  assert.equal(st.track.cover_url, null);
  assert.deepEqual(st.devices.map((d) => d.name).sort(), ['Desktop', 'Laptop']);
  assert.equal((await (await get('/api/devices', bearer(API_READ))).json()).devices.length, 2);

  // ---- commands (relative values are computed by the hub) ----
  const cmd = async (path, body) => {
    desk.inbox.length = 0;
    const res = await post(path, body, bearer(API_FULL));
    await wait();
    return { res, got: last(desk, 'command') };
  };
  let r = await cmd('/api/pause');
  assert.equal(r.res.status, 200);
  assert.equal(r.got.action, 'pause');
  assert.equal(r.got.from, 'api');
  for (const a of ['play', 'toggle', 'next', 'prev']) assert.equal((await cmd('/api/' + a)).got.action, a);

  r = await cmd('/api/seek', { delta: 10 });
  assert.ok(r.got.args.positionSec >= 60 && r.got.args.positionSec < 64);
  r = await cmd('/api/seek', { positionSec: 999 });
  assert.equal(r.got.args.positionSec, 200, 'clamped to the track length');
  r = await cmd('/api/seek', {});
  assert.equal(r.res.status, 400);
  r = await cmd('/api/volume', { delta: -0.1 });
  assert.ok(Math.abs(r.got.args.volume - 0.4) < 1e-9);
  r = await cmd('/api/volume', { volume: 5 });
  assert.equal(r.got.args.volume, 1);
  r = await cmd('/api/shuffle', { value: 'toggle' });
  assert.equal(r.got.args.value, true);
  r = await cmd('/api/repeat', { value: 'cycle' });
  assert.equal(r.got.args.value, 'all');
  r = await cmd('/api/command', { action: 'repeat', args: { value: 'bogus' } });
  assert.equal(r.res.status, 400);
  r = await cmd('/api/command', { action: 'format-disk' });
  assert.equal(r.res.status, 400);
  r = await cmd('/api/command', { action: 'pause', device: 'nobody' });
  assert.equal(r.res.status, 404);

  // targeting a specific device by name
  laptop.inbox.length = 0;
  assert.equal((await post('/api/command', { action: 'pause', device: 'laptop' }, bearer(API_FULL))).status, 200);
  await wait();
  assert.equal(last(laptop, 'command').action, 'pause');

  // ---- partial names: "pc" finds "Living Room PC"; shared words are ambiguous ----
  const pc = connect(PORT, 'living-pc-0001', 'Living Room PC', 'desktop');
  const tv = connect(PORT, 'living-tv-0001', 'Living Room TV', 'desktop');
  await wait();
  pc.inbox.length = 0;
  assert.equal((await post('/api/command', { action: 'pause', device: 'pc' }, bearer(API_FULL))).status, 200);
  await wait();
  assert.equal(last(pc, 'command').action, 'pause');
  const amb = await post('/api/command', { action: 'pause', device: 'living' }, bearer(API_FULL));
  assert.equal(amb.status, 409);
  const ambBody = await amb.json();
  assert.equal(ambBody.error, 'ambiguous_device');
  assert.deepEqual(ambBody.matches.sort(), ['Living Room PC', 'Living Room TV']);
  assert.equal((await post('/api/command', { action: 'pause', device: 'room tv' }, bearer(API_FULL))).status, 200);
  assert.equal((await post('/api/command', { action: 'pause', device: 'nothing-like-this' }, bearer(API_FULL))).status, 404);
  pc.close(); tv.close();
  await wait();

  // ---- transfer by name ----
  desk.inbox.length = 0; laptop.inbox.length = 0;
  assert.equal((await post('/api/transfer', { device: 'Laptop' }, bearer(API_FULL))).status, 200);
  await wait();
  assert.ok(last(desk, 'yield'), 'the playing device is asked to yield first');
  desk.send(JSON.stringify({ t: 'yielded', to: 'lap-api-0001' }));
  await wait();
  assert.ok(last(laptop, 'takeover'));
  assert.equal((await post('/api/transfer', { device: 'Phone remote' }, bearer(API_FULL))).status, 400, 'a web remote cannot be a target');
  assert.equal((await post('/api/transfer', {}, bearer(API_FULL))).status, 404);

  // ---- body limits ----
  const big = await fetch(base + '/api/command', { method: 'POST', headers: { 'content-type': 'application/json', ...bearer(API_FULL) }, body: JSON.stringify({ action: 'pause', pad: 'x'.repeat(20000) }) });
  assert.equal(big.status, 413);
  const bad = await fetch(base + '/api/command', { method: 'POST', headers: bearer(API_FULL), body: '{nope' });
  assert.equal(bad.status, 400);

  // ---- cover art: uploaded by the active device only, validated, served with an ETag ----
  desk.send(JSON.stringify({ t: 'state', state: { trackId: 'song2', title: 'Two', durationSec: 100, positionSec: 0, playing: true } }));
  await wait();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
  const sendCover = (ws, trackId, mime, buf) => ws.send(JSON.stringify({ t: 'cover', trackId, mime, data: buf.toString('base64') }));

  sendCover(desk, 'song2', 'image/png', Buffer.alloc(50, 1)); // wrong magic bytes
  sendCover(laptop, 'song2', 'image/png', png); // not the reporting device
  sendCover(desk, 'other-track', 'image/png', png); // not the current track
  await wait();
  assert.equal((await get('/api/cover', bearer(API_READ))).status, 404);

  sendCover(desk, 'song2', 'image/png', png);
  await wait();
  const cv = await get('/api/cover?track=song2', bearer(API_READ));
  assert.equal(cv.status, 200);
  assert.equal(cv.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await cv.arrayBuffer()), png);
  assert.equal((await get('/api/cover?track=song1', bearer(API_READ))).status, 404, 'cover is per track');
  assert.equal((await get('/api/cover', { cookie })).status, 200, 'the web page can load it with its session');
  const etag = cv.headers.get('etag');
  assert.equal((await get('/api/cover', { ...bearer(API_READ), 'if-none-match': etag })).status, 304);
  const withCover = await (await get('/api/state', bearer(API_READ))).json();
  assert.match(withCover.track.cover_url, /^http:\/\/hub\.test\/api\/cover\?track=song2&v=/);

  // a new track drops the old cover until its own arrives
  desk.send(JSON.stringify({ t: 'state', state: { trackId: 'song3', title: 'Three', durationSec: 100, positionSec: 0, playing: true } }));
  await wait();
  assert.equal((await get('/api/cover', bearer(API_READ))).status, 404);

  // ---- live event stream ----
  const ctl = new AbortController();
  const sseRes = await fetch(base + '/api/events', { headers: bearer(API_READ), signal: ctl.signal });
  assert.equal(sseRes.status, 200);
  assert.match(sseRes.headers.get('content-type'), /text\/event-stream/);
  const reader = sseRes.body.getReader();
  const dec = new TextDecoder();
  let text = '';
  const readSome = async () => { const { value } = await reader.read(); text += dec.decode(value); };
  await readSome();
  assert.match(text, /event: state/);
  assert.match(text, /"title":"Three"/);
  desk.send(JSON.stringify({ t: 'state', state: { trackId: 'song3', title: 'Three', durationSec: 100, positionSec: 5, playing: false } }));
  await readSome();
  assert.match(text, /"playing":false/);
  ctl.abort();
  assert.equal((await get('/api/events')).status, 401);

  // ---- logout ----
  assert.equal((await post('/auth/logout', {}, { cookie })).status, 200);
  assert.equal((await get('/auth/me', { cookie })).status, 401);

  // ---- security headers ----
  const page = await get('/');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
} finally {
  srv.kill();
}

// ================= lockout after repeated failures (own instance, own IP budget) =================
const srv2 = await startHub(5595, { HUB_USER: USER, HUB_PASSWORD: PASS });
try {
  const login = (password) => fetch('http://127.0.0.1:5595/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: USER, password }) });
  for (let i = 0; i < 4; i++) assert.equal((await login('bad-password-x')).status, 401);
  const locked = await login('bad-password-x'); // 5th failure
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  assert.equal((await login(PASS)).status, 429, 'even the right password is refused while locked');
} finally {
  srv2.kill();
}

// ================= startup validation =================
const bad = spawn('node', ['server.js'], { env: { ...process.env, PORT: '5594', HUB_TOKEN: TOKEN, HUB_USER: 'a', HUB_PASSWORD: 'short' } });
const code = await new Promise((r) => bad.on('exit', r));
assert.equal(code, 1, 'refuses to start with a weak password');

// ================= token-mode page keeps working (no HUB_PASSWORD) =================
const srv3 = await startHub(5593);
try {
  assert.equal((await (await fetch('http://127.0.0.1:5593/auth/config')).json()).mode, 'token');
  assert.equal((await fetch('http://127.0.0.1:5593/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 404);
  assert.equal((await fetch('http://127.0.0.1:5593/api/state')).status, 401);
  assert.equal((await fetch('http://127.0.0.1:5593/api/state', { headers: bearer(TOKEN) })).status, 200);
} finally {
  srv3.kill();
}

console.log('auth + api tests passed');
process.exit(0);
