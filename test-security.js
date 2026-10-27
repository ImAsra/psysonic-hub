// Security regression tests: prototype safety, input limits, brute-force lockout, connection and message
// limits, cross-site protections, cookie/HSTS behaviour, CSP, file-based secrets, weak-secret warnings.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const RAND = (n) => [...Array(n)].map(() => 'abcdef0123456789'[Math.floor(Math.random() * 16)]).join('');
const TOKEN = RAND(48);
const FULL = RAND(48);
const READ = RAND(48);
const PASS = 'a-Long_unusual-passphrase-4-tests';
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.t === t);
const JSON_H = { 'content-type': 'application/json' };

async function startHub(port, env = {}) {
  const srv = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(port), HUB_TOKEN: TOKEN, HUB_DATA_DIR: '', ...env },
  });
  srv.exited = null;
  srv.err = '';
  srv.stderr.on('data', (d) => (srv.err += d));
  srv.on('exit', (c) => (srv.exited = c));
  await new Promise((r) => srv.stdout.once('data', r));
  return srv;
}
function dev(port, id, name, { token = TOKEN, kind = 'desktop', headers = {} } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  ws.inbox = [];
  ws.closeCode = null;
  ws.on('message', (d) => ws.inbox.push(JSON.parse(d)));
  ws.on('close', (c) => (ws.closeCode = c));
  ws.on('error', () => {});
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token, deviceId: id, name, kind })));
  return ws;
}
const send = (ws, m) => ws.send(JSON.stringify(m));

// ======================= prototype safety, state and argument limits =======================
{
  const P = 5561;
  const srv = await startHub(P, { API_TOKEN: FULL });
  const A = dev(P, 'dev-a-0010', 'A');
  const B = dev(P, 'dev-b-0010', 'B');
  await wait(300);

  for (const cat of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    send(A, { t: 'sync-config', category: cat, enabled: true });
    send(A, { t: 'settings', category: cat, value: { polluted: 1 } });
    send(A, { t: 'settings', category: cat, value: { polluted: 1 }, init: true });
  }
  await wait(300);
  const C = dev(P, 'dev-c-0010', 'C');
  await wait(300);
  const w = last(C, 'welcome');
  assert.deepEqual(Object.keys(w.syncConfig).sort(), ['appearance', 'eq', 'keybindings', 'loudness', 'lyrics', 'playback']);
  assert.equal(JSON.stringify(w.settings).includes('polluted'), false, 'no setting leaked in through a magic category name');
  assert.deepEqual({}.polluted, undefined);

  // state: only known fields, clamped, truncated
  B.inbox.length = 0;
  send(A, { t: 'state', state: {
    trackId: 't1', title: 'x'.repeat(5000), evil: '<script>alert(1)</script>', __proto__: { admin: true },
    volume: 5, positionSec: -20, durationSec: 'long', repeat: 'bogus', playing: 'yes', shuffle: true,
  } });
  await wait();
  const st = last(B, 'state').state;
  assert.equal(st.title.length, 300);
  assert.equal(st.volume, 1);
  assert.equal(st.positionSec, 0);
  assert.equal(st.evil, undefined);
  assert.equal(st.durationSec, undefined);
  assert.equal(st.repeat, undefined);
  assert.equal(st.playing, undefined);
  assert.equal(st.shuffle, true);
  assert.deepEqual(Object.keys(st).sort(), ['from', 'positionSec', 'shuffle', 'title', 'trackId', 'ts', 'volume']);

  // command arguments: small plain objects only
  B.inbox.length = 0;
  send(A, { t: 'command', to: 'dev-b-0010', action: 'seek', args: { positionSec: 5 } });
  send(A, { t: 'command', to: 'dev-b-0010', action: 'x', args: { blob: 'y'.repeat(5000) } });
  send(A, { t: 'command', to: 'dev-b-0010', action: 'x', args: [1, 2, 3] });
  send(A, { t: 'command', to: 'dev-b-0010', action: 'z'.repeat(100), args: {} });
  await wait();
  const cmds = B.inbox.filter((m) => m.t === 'command');
  assert.equal(cmds.length, 3, 'an over-long action name is dropped');
  assert.deepEqual(cmds[0].args, { positionSec: 5 });
  assert.equal(cmds[1].args, null);
  assert.equal(cmds[2].args, null);
  [A, B, C].forEach((x) => x.close());
  srv.kill();
}

// ======================= guessing the device token locks the address out =======================
{
  const P = 5562;
  const srv = await startHub(P);
  for (let i = 0; i < 10; i++) {
    const bad = dev(P, `guess-${i}-000`, 'G', { token: RAND(48) });
    await wait(40);
    assert.equal(bad.closeCode, 4005);
  }
  const blocked = dev(P, 'right-token-001', 'Legit'); // even the right token is refused while locked
  await wait(200);
  assert.equal(blocked.closeCode, 4011);
  srv.kill();
}

// ======================= guessing an API token locks the address out =======================
{
  const P = 5563;
  const srv = await startHub(P, { API_TOKEN: FULL, API_TOKEN_READONLY: READ });
  const call = (t) => fetch(`http://127.0.0.1:${P}/api/state`, { headers: t ? { authorization: `Bearer ${t}` } : {} });
  for (let i = 0; i < 5; i++) assert.equal((await call()).status, 401); // no credentials at all: not counted
  assert.equal((await call(READ)).status, 200);
  for (let i = 0; i < 10; i++) assert.equal((await call(RAND(48))).status, 401);
  const locked = await call(READ);
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  srv.kill();
}

// ======================= connection and message limits =======================
{
  const P = 5564;
  const srv = await startHub(P, { HUB_MAX_CONNECTIONS_PER_IP: '3' });
  const socks = [1, 2, 3, 4].map((i) => dev(P, `many-${i}-0000`, `M${i}`));
  await wait(400);
  assert.equal(socks.filter((s) => s.closeCode === 4010).length, 1, 'the 4th connection from one address is refused');
  socks.forEach((s) => s.close());
  await wait(200);

  const flood = dev(P, 'flood-00001', 'Flood');
  await wait(250);
  for (let i = 0; i < 300; i++) send(flood, { t: 'ping' });
  await wait(300);
  assert.equal(flood.closeCode, 4012, 'a connection that floods the hub is cut off');

  const calm = dev(P, 'calm-000001', 'Calm');
  await wait(250);
  for (let i = 0; i < 40; i++) send(calm, { t: 'ping' }); // an ordinary burst is fine
  await wait(300);
  assert.equal(calm.closeCode, null);
  assert.ok(!srv.exited);
  calm.close();
  srv.kill();
}

// ======================= cross-site protections on login/logout =======================
{
  const P = 5565;
  const srv = await startHub(P, { HUB_USER: 'asra', HUB_PASSWORD: PASS });
  const base = `http://127.0.0.1:${P}`;
  const body = JSON.stringify({ user: 'asra', password: PASS });
  const login = (headers) => fetch(`${base}/auth/login`, { method: 'POST', headers, body });
  assert.equal((await login({ ...JSON_H, origin: 'http://evil.example' })).status, 403, 'cross-origin page');
  assert.equal((await login({ ...JSON_H, 'sec-fetch-site': 'cross-site' })).status, 403, 'browser says cross-site');
  assert.equal((await login({ 'content-type': 'text/plain' })).status, 415, 'a plain cross-site form post cannot be JSON');
  assert.equal((await login({})).status, 415);
  assert.equal((await login({ ...JSON_H, origin: base, 'sec-fetch-site': 'same-origin' })).status, 200, 'the real page works');
  assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST', headers: { ...JSON_H, origin: 'http://evil.example' } })).status, 403);
  srv.kill();
}

// ======================= cookies and HSTS behind an HTTPS proxy =======================
{
  const P = 5566;
  const srv = await startHub(P, { HUB_USER: 'asra', HUB_PASSWORD: PASS, HUB_TRUST_PROXY: '1' });
  const base = `http://127.0.0.1:${P}`;
  const https = { 'x-forwarded-proto': 'https' };
  const body = JSON.stringify({ user: 'asra', password: PASS });

  const secure = await fetch(`${base}/auth/login`, { method: 'POST', headers: { ...JSON_H, ...https }, body });
  const cookie = secure.headers.get('set-cookie');
  assert.match(cookie, /^__Host-hub_session=/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  const c = cookie.split(';')[0];
  assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie: c, ...https } })).status, 200);
  assert.equal((await fetch(`${base}/auth/me`, { headers: { cookie: c } })).status, 401, 'a Secure-only cookie is not honoured over plain http');
  assert.ok((await fetch(`${base}/`, { headers: https })).headers.get('strict-transport-security'));
  assert.equal((await fetch(`${base}/`)).headers.get('strict-transport-security'), null);

  const plain = await fetch(`${base}/auth/login`, { method: 'POST', headers: JSON_H, body });
  assert.match(plain.headers.get('set-cookie'), /^hub_session=/);
  assert.doesNotMatch(plain.headers.get('set-cookie'), /Secure/);
  srv.kill();
}

// ======================= strict CSP, no inline code, safe static files =======================
{
  const P = 5567;
  const srv = await startHub(P);
  const base = `http://127.0.0.1:${P}`;
  const page = await fetch(`${base}/`);
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.ok(page.headers.get('permissions-policy'));
  const html = await page.text();
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'no inline <script>');
  assert.doesNotMatch(html, /<style[\s>]/i, 'no inline <style>');
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/i, 'no style attributes or inline event handlers');
  const js = await fetch(`${base}/app.js`);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${base}/app.css`)).status, 200);
  for (const evil of ['/public/app.js', '/..%2Fserver.js', '/lib/core.js', '/.env', '/package.json', '/app.js/../server.js']) {
    assert.equal((await fetch(`${base}${evil}`)).status, 404, evil);
  }

  // a logo you drop into ./public is served sandboxed (never allowed to run script)
  const logo = new URL('./public/logo.svg', import.meta.url);
  const had = fs.existsSync(logo);
  if (!had) fs.writeFileSync(logo, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  try {
    const r = await fetch(`${base}/logo.svg`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  } finally {
    if (!had) fs.unlinkSync(logo);
  }
  srv.kill();
}

// ======================= secrets from files, distinct secrets, weak-secret warning, clean shutdown =======================
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-secrets-'));
  const tokenFile = path.join(dir, 'token');
  fs.writeFileSync(tokenFile, `${TOKEN}\n`);

  const env = { HUB_TOKEN: '', HUB_TOKEN_FILE: tokenFile };
  const P = 5568;
  const srv = await startHub(P, env);
  const ws = dev(P, 'file-secret-01', 'FileSecret');
  await wait(300);
  assert.ok(last(ws, 'welcome'), 'a token read from HUB_TOKEN_FILE works');
  assert.equal(srv.err.includes('guessable'), false, 'a generated secret raises no warning');
  ws.close();
  srv.kill('SIGTERM');
  await wait(600);
  assert.equal(srv.exited, 0, 'SIGTERM stops the hub cleanly');

  const missing = spawn('node', ['server.js'], { env: { ...process.env, PORT: '5569', HUB_TOKEN: '', HUB_TOKEN_FILE: path.join(dir, 'nope') } });
  let merr = '';
  missing.stderr.on('data', (d) => (merr += d));
  assert.equal(await new Promise((r) => missing.on('exit', r)), 1);
  assert.match(merr, /HUB_TOKEN_FILE could not be read/);

  const same = spawn('node', ['server.js'], { env: { ...process.env, PORT: '5569', HUB_TOKEN: TOKEN, API_TOKEN: TOKEN } });
  let serr = '';
  same.stderr.on('data', (d) => (serr += d));
  assert.equal(await new Promise((r) => same.on('exit', r)), 1);
  assert.match(serr, /must all be different/);

  const weak = await startHub(5569, { HUB_TOKEN: 'testtoken1234567890' });
  assert.match(weak.err, /\[security\] HUB_TOKEN looks guessable/);
  weak.kill();

  const proxy = await startHub(5560, { HUB_TRUST_PROXY: '1' });
  assert.match(proxy.err, /HUB_TRUST_PROXY=1: make sure only your reverse proxy/);
  proxy.kill();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('security tests passed');
process.exit(0);
