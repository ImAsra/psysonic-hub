// Regression tests for the issues found in review: server/account matching, safe handoff,
// sockets ending with their login session, malformed input, per-device relative commands.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const TOKEN = 'device-token-1234567890';
const FULL = 'api-full-token-abcdefghijkl';
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.t === t);
const has = (ws, t) => ws.inbox.some((m) => m.t === t);
const clear = (...wss) => wss.forEach((w) => (w.inbox.length = 0));

async function startHub(port, env = {}) {
  const srv = spawn('node', ['server.js'], {
    env: { ...process.env, PORT: String(port), HUB_TOKEN: TOKEN, HUB_DATA_DIR: '', ...env },
  });
  srv.exited = false;
  srv.on('exit', () => (srv.exited = true));
  await new Promise((r) => srv.stdout.once('data', r));
  return srv;
}
function dev(port, id, name, { kind = 'desktop', server, token = TOKEN, headers = {} } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers });
  ws.inbox = [];
  ws.closeCode = null;
  ws.on('message', (d) => ws.inbox.push(JSON.parse(d)));
  ws.on('close', (c) => (ws.closeCode = c));
  ws.on('error', () => {});
  ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token, deviceId: id, name, kind, server })));
  return ws;
}
const send = (ws, m) => ws.send(JSON.stringify(m));
const playing = (extra = {}) => ({ t: 'state', state: { trackId: 't1', title: 'T', durationSec: 200, positionSec: 30, playing: true, volume: 0.5, ...extra } });

// ======================= server / account matching =======================
{
  const P = 5571;
  const srv = await startHub(P, { API_TOKEN: FULL });
  const A = dev(P, 'dev-a-0001', 'A', { server: ['aaaaaaaa11111111'] });
  const B = dev(P, 'dev-b-0001', 'B', { server: ['bbbbbbbb22222222'] }); // different account
  const C = dev(P, 'dev-c-0001', 'C', { server: ['cccccccc33333333', 'aaaaaaaa11111111'] }); // shares one address with A (LAN vs public)
  const U = dev(P, 'dev-u-0001', 'U'); // old client: does not say
  await wait(300);
  send(A, playing());
  await wait();
  assert.equal(last(A, 'devices').devices.find((d) => d.id === 'dev-b-0001').server[0], 'bbbbbbbb22222222');

  // refused: B uses another account; nobody is asked to yield and B never takes over
  clear(A, B);
  send(A, { t: 'transfer', to: 'dev-b-0001' });
  await wait();
  assert.equal(last(A, 'transfer-failed').reason, 'server_mismatch');
  assert.ok(!has(A, 'yield') && !has(B, 'takeover'));

  // allowed: an overlapping address, or a device that does not say
  clear(A, C, U);
  send(A, { t: 'transfer', to: 'dev-c-0001' });
  await wait();
  assert.ok(has(A, 'yield'));
  send(A, { t: 'yielded', to: 'dev-c-0001', ok: true });
  await wait();
  assert.ok(has(C, 'takeover'));
  send(C, playing());
  await wait();
  clear(C, U);
  send(C, { t: 'transfer', to: 'dev-u-0001' });
  await wait();
  assert.ok(has(C, 'yield'));
  send(C, { t: 'yielded', to: 'dev-u-0001' }); // an old client sends no "ok": counts as ok
  await wait();
  assert.ok(has(U, 'takeover'));

  // the queue signal only reaches devices that share the account
  clear(A, B, C);
  send(C, { t: 'queue-changed' });
  await wait();
  assert.ok(has(A, 'queue-changed'));
  assert.ok(!has(B, 'queue-changed'), 'a foreign account must not receive another account\'s queue signal');

  // click-to-play from a controller moves ITS queue: the requester's account is what counts
  send(U, playing({ trackId: 't9' }));
  await wait();
  clear(B, U);
  send(B, { t: 'transfer', to: 'dev-u-0001', fresh: true }); // B (other account) pushed a queue, target U unknown -> allowed
  await wait();
  clear(A, B);
  send(B, { t: 'transfer', to: 'dev-a-0001', fresh: true });
  await wait();
  assert.equal(last(B, 'transfer-failed').reason, 'server_mismatch');
  assert.ok(!has(A, 'takeover'));

  [A, B, C, U].forEach((w) => w.close());
  srv.kill();
}

// REST: a transfer to another account is refused with 409
{
  const P = 5578;
  const srv = await startHub(P, { API_TOKEN: FULL });
  const X = dev(P, 'dev-x-0007', 'Xray', { server: ['aaaaaaaa11111111'] });
  const Y = dev(P, 'dev-y-0007', 'Yankee', { server: ['bbbbbbbb22222222'] });
  await wait(300);
  send(X, playing());
  await wait();
  const r = await fetch(`http://127.0.0.1:${P}/api/transfer`, { method: 'POST', headers: { authorization: `Bearer ${FULL}` }, body: JSON.stringify({ device: 'Yankee' }) });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'server_mismatch');
  X.close(); Y.close(); srv.kill();
}

// switching accounts on a device updates its answer; the check can be switched off
{
  const P = 5572;
  const srv = await startHub(P);
  const A = dev(P, 'dev-a-0002', 'A', { server: ['aaaaaaaa11111111'] });
  const B = dev(P, 'dev-b-0002', 'B', { server: ['bbbbbbbb22222222'] });
  await wait(300);
  send(A, playing());
  await wait();
  clear(A, B);
  send(B, { t: 'server', server: ['aaaaaaaa11111111'] }); // B signed in to A's account
  await wait();
  send(A, { t: 'transfer', to: 'dev-b-0002' });
  await wait();
  assert.ok(has(A, 'yield'), 'same account now');
  A.close(); B.close(); srv.kill();

  const P2 = 5573;
  const off = await startHub(P2, { HUB_SERVER_CHECK: 'off' });
  const X = dev(P2, 'dev-x-0001', 'X', { server: ['aaaaaaaa11111111'] });
  const Y = dev(P2, 'dev-y-0001', 'Y', { server: ['bbbbbbbb22222222'] });
  await wait(300);
  send(X, playing());
  await wait();
  clear(X);
  send(X, { t: 'transfer', to: 'dev-y-0001' });
  await wait();
  assert.ok(has(X, 'yield'), 'HUB_SERVER_CHECK=off lets it through');
  X.close(); Y.close(); off.kill();
}

// ======================= safe handoff =======================
{
  const P = 5574;
  const srv = await startHub(P, { HUB_YIELD_TIMEOUT_MS: '500' });
  const A = dev(P, 'dev-a-0003', 'A');
  const B = dev(P, 'dev-b-0003', 'B');
  const R = dev(P, 'dev-r-0003', 'Remote', { kind: 'web' });
  await wait(300);
  send(A, playing());
  await wait();

  // the playing device could not save its queue -> cancelled, A resumes, B never loads a stale queue
  clear(A, B, R);
  send(R, { t: 'transfer', to: 'dev-b-0003' });
  await wait();
  assert.ok(has(A, 'yield'));
  send(A, { t: 'state', state: { trackId: 't1', playing: false, positionSec: 31 } }); // it paused...
  send(A, { t: 'yielded', to: 'dev-b-0003', ok: false, reason: 'queue_save_failed' }); // ...but could not save
  await wait();
  assert.equal(last(R, 'transfer-failed').reason, 'queue_save_failed');
  assert.ok(!has(B, 'takeover'), 'no takeover after a failed save');
  assert.equal(last(A, 'command')?.action, 'play', 'the old device is told to carry on');

  // no answer at all -> cancelled after the timeout (not silently pushed through)
  send(A, playing());
  await wait();
  clear(A, B, R);
  send(R, { t: 'transfer', to: 'dev-b-0003' });
  await wait(900);
  assert.equal(last(R, 'transfer-failed').reason, 'timeout');
  assert.ok(!has(B, 'takeover'));
  send(A, { t: 'yielded', to: 'dev-b-0003' }); // too late: ignored
  await wait();
  assert.ok(!has(B, 'takeover'));

  // the target could not load the queue: nobody plays, the requester hears about it
  send(A, playing());
  await wait();
  clear(A, B, R);
  send(R, { t: 'transfer', to: 'dev-b-0003' });
  await wait();
  send(A, { t: 'yielded', to: 'dev-b-0003', ok: true });
  await wait();
  assert.ok(has(B, 'takeover'));
  send(B, { t: 'takeover-failed', reason: 'queue_unavailable' });
  await wait();
  assert.equal(last(R, 'transfer-failed').reason, 'queue_unavailable');
  assert.ok(!last(R, 'devices').devices.some((d) => d.active), 'no device is left marked active');

  // the playing device disappears mid-handoff: there is nothing to wait for
  send(A, playing());
  await wait();
  clear(B, R);
  send(R, { t: 'transfer', to: 'dev-b-0003' });
  await wait(100);
  A.close();
  await wait();
  assert.ok(has(B, 'takeover'));
  B.close(); R.close(); srv.kill();
}

// ======================= malformed input must not kill the hub =======================
{
  const P = 5575;
  const srv = await startHub(P);
  const A = dev(P, 'dev-a-0004', 'A');
  await wait(300);
  send(A, playing());
  await wait();
  const junk = [
    { t: 'cover', trackId: 't1', mime: '__proto__', data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    { t: 'cover', trackId: 't1', mime: 'constructor', data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    { t: 'cover', trackId: 't1', mime: 'toString', data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    { t: 'cover', trackId: 't1', mime: 'image/png', data: 12345 },
    { t: 'cover', trackId: { a: 1 }, mime: ['image/png'], data: null },
    { t: 'cover' }, { t: 'state', state: 5 }, { t: 'state', state: [1] }, { t: 'state', state: { volume: 'x', positionSec: {}, playing: [] } },
    { t: 'command', to: {}, action: 5 }, { t: 'command', to: 'dev-a-0004', action: 'x', args: 7 },
    { t: 'transfer', to: null }, { t: 'transfer', to: ['x'], fresh: 'yes' },
    { t: 'yielded', ok: {}, reason: {} }, { t: 'takeover-failed', reason: {} },
    { t: 'server', server: 5 }, { t: 'server', server: [{}, null, 'zz'] },
    { t: 'settings', category: {}, value: 1 }, { t: 'sync-config', category: [], enabled: {} },
  ];
  for (const m of junk) send(A, m);
  A.send('null'); A.send('[]'); A.send('"x"'); A.send('12');
  await wait(400);
  assert.ok(!srv.exited, 'the hub survived every malformed message');
  const h = await fetch(`http://127.0.0.1:${P}/health`);
  assert.equal(h.status, 200);
  const cover = await fetch(`http://127.0.0.1:${P}/api/cover`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(cover.status, 404, 'none of the bogus covers was stored');
  A.close(); srv.kill();
}

// ======================= sockets end with their login session =======================
{
  const P = 5576;
  const srv = await startHub(P, { HUB_USER: 'asra', HUB_PASSWORD: 'correct-horse-battery' });
  const base = `http://127.0.0.1:${P}`;
  const login = async () => (await fetch(`${base}/auth/login`, { method: 'POST', body: JSON.stringify({ user: 'asra', password: 'correct-horse-battery' }) })).headers.get('set-cookie').split(';')[0];
  const cookieA = await login();
  const cookieB = await login();
  const player = dev(P, 'dev-p-0005', 'Player');
  const pageA = dev(P, 'web-a-0005', 'Page A', { token: null, headers: { cookie: cookieA, origin: base } });
  const pageB = dev(P, 'web-b-0005', 'Page B', { token: null, headers: { cookie: cookieB, origin: base } });
  const cli = dev(P, 'cli-c-0005', 'CLI', { kind: 'web' }); // token login, same user: not tied to any session
  await wait(400);
  assert.ok(last(pageA, 'welcome') && last(pageB, 'welcome'));

  await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: cookieA } });
  await wait(300);
  assert.equal(pageA.closeCode, 4005, 'signing out closes that page\'s socket');
  assert.equal(pageB.closeCode, null, 'another session is untouched');
  assert.equal(cli.closeCode, null, 'a token connection is untouched');
  clear(player);
  send(pageA, { t: 'command', to: 'dev-p-0005', action: 'pause' }); // the dead socket can no longer do anything
  send(pageB, { t: 'command', to: 'dev-p-0005', action: 'pause' });
  await wait();
  assert.equal(player.inbox.filter((m) => m.t === 'command').length, 1, 'only the still-signed-in page controls playback');
  [player, pageB, cli].forEach((w) => w.close());
  srv.kill();
}

// ======================= relative REST commands use the TARGET device's state =======================
{
  const P = 5577;
  const srv = await startHub(P, { API_TOKEN: FULL });
  const A = dev(P, 'dev-a-0006', 'Alpha');
  const B = dev(P, 'dev-b-0006', 'Beta');
  const N = dev(P, 'dev-n-0006', 'Nostate');
  await wait(300);
  send(B, { t: 'state', state: { trackId: 'x', playing: false, positionSec: 100, durationSec: 150, volume: 0.2, shuffle: true, repeat: 'all' } });
  send(A, playing({ volume: 0.8, positionSec: 10, shuffle: false, repeat: 'off' }));
  await wait();
  const call = async (path, body) => {
    clear(A, B, N);
    const res = await fetch(`http://127.0.0.1:${P}/api/${path}`, { method: 'POST', headers: { authorization: `Bearer ${FULL}` }, body: JSON.stringify(body) });
    await wait();
    return { res, b: last(B, 'command'), a: last(A, 'command'), n: last(N, 'command') };
  };
  let r = await call('volume', { delta: 0.1, device: 'Beta' });
  assert.ok(Math.abs(r.b.args.volume - 0.3) < 1e-9, `Beta was at 20%, +10% must be 30% (got ${r.b.args.volume})`);
  assert.ok(!r.a);
  r = await call('volume', { delta: 0.1 }); // no device: the active one (Alpha, at 80%)
  assert.ok(Math.abs(r.a.args.volume - 0.9) < 1e-9);
  r = await call('seek', { delta: 20, device: 'Beta' });
  assert.equal(r.b.args.positionSec, 120, 'relative to Beta\'s own position');
  r = await call('seek', { delta: 999, device: 'Beta' });
  assert.equal(r.b.args.positionSec, 150, 'clamped to Beta\'s own track length');
  r = await call('shuffle', { value: 'toggle', device: 'Beta' });
  assert.equal(r.b.args.value, false, 'Beta had shuffle on');
  r = await call('repeat', { value: 'cycle', device: 'Beta' });
  assert.equal(r.b.args.value, 'one', 'Beta had repeat on "all"');
  r = await call('volume', { delta: 0.1, device: 'Nostate' });
  assert.equal(r.res.status, 409);
  assert.equal((await r.res.json()).error, 'device_state_unknown');
  assert.ok(!r.n);
  r = await call('volume', { volume: 0.4, device: 'Nostate' }); // absolute values need no known state
  assert.equal(r.res.status, 200);

  // bodies that are not objects are rejected, not crashed on
  for (const body of ['null', '[]', '5', '"x"']) {
    const res = await fetch(`http://127.0.0.1:${P}/api/pause`, { method: 'POST', headers: { authorization: `Bearer ${FULL}` }, body });
    assert.equal(res.status, 400, `body ${body}`);
  }
  [A, B, N].forEach((w) => w.close());
  srv.kill();
}

console.log('hardening tests passed');
process.exit(0);
