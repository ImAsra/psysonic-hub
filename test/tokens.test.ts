// The device token: generated and kept when HUB_TOKEN is not set, shown and regenerated from Settings.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import WebSocket from 'ws';

import { body, type TestProc, type TestSocket } from './types.ts';

process.setMaxListeners(30);
const PORT = 5588;
const base = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-tokens-'));
const READONLY = 'ro-' + 'k'.repeat(30) + 'Zq81Lm';

async function startHub(env: Record<string, string> = {}) {
  const srv = spawn('node', ['server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), HUB_TOKEN: '', HUB_DATA_DIR: dataDir, ...env },
  }) as TestProc;
  process.once('exit', () => srv.kill());
  srv.err = '';
  let out = '';
  srv.stdout.on('data', (d) => (out += d));
  srv.stderr.on('data', (d) => (srv.err += d));
  await new Promise<void>((resolve) => {
    const check = () => (out.includes('listening') ? resolve() : setTimeout(check, 20));
    check();
  });
  return { srv, out };
}
const stop = (srv: TestProc) => new Promise((r) => (srv.once('exit', r), srv.kill()));

const connect = (token: string) =>
  new Promise<TestSocket>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`) as TestSocket;
    ws.inbox = [];
    ws.closed = new Promise((r) => ws.once('close', (c) => r(c)));
    ws.on('message', (d) => ws.inbox.push(JSON.parse(String(d))));
    ws.once('open', () => {
      ws.send(JSON.stringify({ t: 'hello', v: 1, token, deviceId: 'desk-' + Math.random().toString(36).slice(2, 8), name: 'D', kind: 'desktop' }));
      resolve(ws);
    });
  });
const welcomed = async (ws: TestSocket) => {
  for (let i = 0; i < 50 && !ws.inbox.some((m) => m.t === 'welcome'); i++) await new Promise((r) => setTimeout(r, 20));
  return ws.inbox.some((m) => m.t === 'welcome');
};
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

// ---- generated on the first start, printed once, kept across restarts ----
let first = await startHub({ API_TOKEN_READONLY: READONLY });
const printed = /device token[^:]*: ([a-f0-9]{48})/.exec(first.out)?.[1];
assert.ok(printed, 'the first start prints the generated token');
const file = path.join(dataDir, 'hub-token');
assert.equal(fs.readFileSync(file, 'utf8').trim(), printed);
assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'only the hub user can read the token file');
assert.ok(await welcomed(await connect(printed)), 'a player signs in with the generated token');
await stop(first.srv);

first = await startHub({ API_TOKEN_READONLY: READONLY });
assert.doesNotMatch(first.out, /device token/, 'a restart does not print the token again');
const settings = await fetch(`${base}/settings/token`, { headers: bearer(printed) });
assert.equal(settings.status, 200);
assert.deepEqual(await body(settings), { token: printed, source: 'generated' }, 'a restart keeps the same token');

// ---- who may see it ----
assert.equal((await fetch(`${base}/settings/token`)).status, 401);
assert.equal(
  (await fetch(`${base}/settings/token`, { headers: bearer(READONLY) })).status,
  401,
  'the read-only API token never reveals the device token',
);

// ---- regenerating: the old token stops working at once, the new one is kept ----
const player = await connect(printed);
assert.ok(await welcomed(player));
const regen = await fetch(`${base}/settings/token`, {
  method: 'POST',
  headers: { ...bearer(printed), 'content-type': 'application/json' },
  body: '{}',
});
assert.equal(regen.status, 200);
const { token: fresh } = await body(regen);
assert.match(fresh, /^[a-f0-9]{48}$/);
assert.notEqual(fresh, printed);
assert.equal(await player.closed, 4005, 'players on the old token are disconnected');
assert.equal(await (await connect(printed)).closed, 4005, 'the old token is refused');
assert.ok(await welcomed(await connect(fresh)), 'the new token works');
await stop(first.srv);

first = await startHub();
assert.equal((await body(await fetch(`${base}/settings/token`, { headers: bearer(fresh) }))).token, fresh, 'the new token survives a restart');
await stop(first.srv);

// ---- HUB_TOKEN set: it always wins and cannot be regenerated from the page ----
const ENV_TOKEN = 'env-' + 'x'.repeat(20) + 'Q7v2';
first = await startHub({ HUB_TOKEN: ENV_TOKEN });
assert.doesNotMatch(first.out, /device token/);
assert.deepEqual(await body(await fetch(`${base}/settings/token`, { headers: bearer(ENV_TOKEN) })), {
  token: ENV_TOKEN,
  source: 'env',
});
const locked = await fetch(`${base}/settings/token`, {
  method: 'POST',
  headers: { ...bearer(ENV_TOKEN), 'content-type': 'application/json' },
  body: '{}',
});
assert.equal(locked.status, 409);
assert.equal((await body(locked)).error, 'token_from_env');
await stop(first.srv);

// ---- web login: the session may see and regenerate it, but only from this site's page ----
const PASSWORD = 'pw-' + 'p'.repeat(12) + 'X9k2Lq';
first = await startHub({ HUB_USER: 'me', HUB_PASSWORD: PASSWORD });
const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ user: 'me', password: PASSWORD }),
});
const cookie = login.headers.get('set-cookie')!.split(';')[0];
assert.equal((await fetch(`${base}/settings/token`, { headers: { cookie } })).status, 200);
const crossSite = await fetch(`${base}/settings/token`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
  body: '{}',
});
assert.equal(crossSite.status, 403, 'another site cannot regenerate the token with your session');
const formPost = await fetch(`${base}/settings/token`, { method: 'POST', headers: { cookie, 'content-type': 'text/plain' }, body: '{}' });
assert.equal(formPost.status, 415);
const own = await fetch(`${base}/settings/token`, {
  method: 'POST',
  headers: { cookie, 'content-type': 'application/json', origin: base },
  body: '{}',
});
assert.equal(own.status, 200);
await stop(first.srv);

fs.rmSync(dataDir, { recursive: true, force: true });
console.log('token tests passed');
process.exit(0);
