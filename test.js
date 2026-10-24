// Smoke test: auth, device list, state relay, command relay, transfer.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const TOKEN = 'test-token-1234567890';
const PORT = 5599;
const srv = spawn('node', ['server.js'], { env: { ...process.env, HUB_TOKEN: TOKEN, PORT } });
await new Promise((r) => srv.stdout.once('data', r));

const page = await fetch(`http://127.0.0.1:${PORT}/`);
assert.equal(page.status, 200);
assert.match(await page.text(), /Psysonic Remote/);
assert.equal((await fetch(`http://127.0.0.1:${PORT}/etc/passwd`)).status, 404);
// branding files are optional: served when present, plain 404 otherwise (never an error)
assert.ok([200, 404].includes((await fetch(`http://127.0.0.1:${PORT}/logo.svg`)).status));
assert.ok([200, 404].includes((await fetch(`http://127.0.0.1:${PORT}/icon.png`)).status));
assert.equal((await fetch(`http://127.0.0.1:${PORT}/logo.svg/../server.js`)).status, 404);

const url = `ws://127.0.0.1:${PORT}/ws`;
const connect = (deviceId, name, kind, token = TOKEN) =>
  new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.inbox = [];
    ws.on('message', (d) => ws.inbox.push(JSON.parse(d)));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', v: 1, token, deviceId, name, kind })));
    resolve(ws);
  });
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.t === t);

// bad token gets closed
const bad = await connect('evil-device', 'x', 'phone', 'wrong');
const code = await new Promise((r) => bad.on('close', r));
assert.equal(code, 4005);

const desk = await connect('desk-0001', 'Desktop', 'desktop');
const phone = await connect('phone-0001', 'Phone', 'phone');
await wait();
assert.equal(last(phone, 'welcome').devices.length, 2);

desk.send(JSON.stringify({ t: 'state', state: { trackId: 'abc', positionMs: 1000, playing: true } }));
await wait();
assert.equal(last(phone, 'state').state.trackId, 'abc');

phone.send(JSON.stringify({ t: 'command', to: 'desk-0001', action: 'pause' }));
await wait();
assert.equal(last(desk, 'command').action, 'pause');

// remotes (kind web) are never valid transfer targets
const web = await connect('web-0001', 'Remote page', 'web');
await wait();
web.inbox.length = 0; desk.inbox.length = 0;
phone.send(JSON.stringify({ t: 'transfer', to: 'web-0001' }));
await wait();
assert.equal(last(desk, 'yield'), undefined);
assert.equal(last(web, 'takeover'), undefined);

// transfer with handshake: desk is active (playing) -> must yield before phone takes over
phone.inbox.length = 0; desk.inbox.length = 0;
phone.send(JSON.stringify({ t: 'transfer', to: 'phone-0001' }));
await wait();
assert.equal(last(desk, 'yield').to, 'phone-0001');
assert.equal(last(phone, 'takeover'), undefined, 'must wait for yielded');
desk.send(JSON.stringify({ t: 'yielded', to: 'phone-0001' }));
await wait();
assert.equal(last(phone, 'takeover').state.trackId, 'abc');
assert.equal(typeof last(phone, 'takeover').ageMs, 'number');

// click-to-play on a controller: transfer to the already-active device with fresh=true
phone.inbox.length = 0;
desk.send(JSON.stringify({ t: 'transfer', to: 'phone-0001', fresh: true }));
await wait();
// (desk is active at this point, so phone yields-handshake path applies; just assert fresh is forwarded after yielded)
desk.send(JSON.stringify({ t: 'yielded', to: 'phone-0001' }));
await wait();
assert.equal(last(phone, 'takeover')?.fresh, true);

// exclusivity: desk starts playing again -> phone (now active) is told to pause
phone.inbox.length = 0;
desk.send(JSON.stringify({ t: 'state', state: { trackId: 'xyz', playing: true } }));
await wait();
assert.equal(last(phone, 'command').action, 'pause');

// idle device must not overwrite the active device's state
phone.send(JSON.stringify({ t: 'state', state: { trackId: 'idle', playing: false } }));
await wait();
assert.equal(last(desk, 'state')?.state.trackId === 'idle', false);

// active device disappears -> playback marked stopped, position kept
const watcher = await connect('watch-0001', 'Watcher', 'desktop');
await wait();
desk.send(JSON.stringify({ t: 'state', state: { trackId: 'xyz', positionSec: 10, playing: true } }));
await wait();
watcher.inbox.length = 0;
desk.close();
await wait();
const after = last(watcher, 'state');
assert.equal(after.state.playing, false);
assert.ok(after.state.positionSec >= 10);

// queue-changed is relayed to the other devices only
const w2 = await connect('watch-0002', 'Watcher 2', 'desktop');
await wait();
w2.inbox.length = 0; watcher.inbox.length = 0;
watcher.send(JSON.stringify({ t: 'queue-changed' }));
await wait();
assert.equal(last(w2, 'queue-changed').from, 'watch-0001');
assert.equal(last(watcher, 'queue-changed'), undefined);

// settings sync: catalog + defaults in welcome
const cfgClient = await connect('cfg-0001', 'Config client', 'desktop');
const cfgPeer = await connect('cfg-0002', 'Config peer', 'phone');
await wait();
const wel = last(cfgClient, 'welcome');
assert.equal(wel.syncCatalog.length, 6);
assert.equal(wel.syncConfig.playback, true);
assert.equal(wel.syncConfig.eq, false);

// a category that is switched off is ignored
cfgPeer.inbox.length = 0;
cfgClient.send(JSON.stringify({ t: 'settings', category: 'eq', value: { gains: [1, 2] } }));
await wait();
assert.equal(last(cfgPeer, 'settings'), undefined);

// switching it on is broadcast to everyone, including the sender
cfgClient.inbox.length = 0;
cfgClient.send(JSON.stringify({ t: 'sync-config', category: 'eq', enabled: true }));
await wait();
assert.equal(last(cfgPeer, 'sync-config').config.eq, true);
assert.equal(last(cfgClient, 'sync-config').config.eq, true);

// init fills an empty slot once; a second init gets the existing value instead
cfgClient.send(JSON.stringify({ t: 'settings', category: 'eq', value: { gains: [1, 2] }, init: true }));
await wait();
assert.deepEqual(last(cfgPeer, 'settings').value, { gains: [1, 2] });
cfgPeer.inbox.length = 0; cfgClient.inbox.length = 0;
cfgPeer.send(JSON.stringify({ t: 'settings', category: 'eq', value: { gains: [9, 9] }, init: true }));
await wait();
assert.deepEqual(last(cfgPeer, 'settings').value, { gains: [1, 2] }); // told to adopt
assert.equal(last(cfgClient, 'settings'), undefined);

// a normal change is accepted and relayed
cfgClient.send(JSON.stringify({ t: 'settings', category: 'eq', value: { gains: [3, 3] } }));
await wait();
assert.deepEqual(last(cfgPeer, 'settings').value, { gains: [3, 3] });

// junk is rejected
cfgPeer.inbox.length = 0;
cfgClient.send(JSON.stringify({ t: 'settings', category: 'eq', value: [1, 2, 3] }));
cfgClient.send(JSON.stringify({ t: 'settings', category: 'nope', value: { a: 1 } }));
await wait();
assert.equal(last(cfgPeer, 'settings'), undefined);

// a late joiner gets the stored values; disabling a category forgets its value
const late = await connect('late-0001', 'Late joiner', 'desktop');
await wait();
assert.deepEqual(last(late, 'welcome').settings.eq, { gains: [3, 3] });
cfgClient.send(JSON.stringify({ t: 'sync-config', category: 'eq', enabled: false }));
await wait();
const late2 = await connect('late-0002', 'Late joiner 2', 'desktop');
await wait();
assert.equal(last(late2, 'welcome').settings.eq, undefined);

console.log('all tests passed');
srv.kill();
process.exit(0);
