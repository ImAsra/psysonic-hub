// Queue windows, library browsing and artwork, all relayed through a player.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { body, type TestProc, type TestSocket } from './types.ts';


const TOKEN = 'test-token-1234567890';
const PORT = 5597;
const srv = spawn('node', ['server/index.ts'], { env: { ...process.env, HUB_TOKEN: TOKEN, PORT: String(PORT) } }) as TestProc;
await new Promise((r) => srv.stdout.once('data', r));

const connect = (deviceId, kind) =>
  new Promise<TestSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`) as TestSocket;
    ws.inbox = [];
    ws.on('message', (d) => ws.inbox.push(JSON.parse(String(d))));
    ws.once('error', reject);
    ws.once('open', () => {
      ws.closed = new Promise((r) => ws.once('close', r));
      ws.send(JSON.stringify({ t: 'hello', v: 1, token: TOKEN, deviceId, name: deviceId, kind }));
      resolve(ws);
    });
  });
const wait = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const last = (ws, t) => [...ws.inbox].reverse().find((m) => m.t === t);
const send = (ws, m) => ws.send(JSON.stringify(m));

const desk = await connect('desk-0001', 'desktop');
const remote = await connect('remote-01', 'phone');
await wait();

// ---- queue ----
// a player's queue reaches the others, junk fields are dropped and the window is capped
send(desk, {
  t: 'queue',
  queue: {
    index: 1, offset: 0, total: 2,
    tracks: [{ id: 'a', title: 'One', secret: 'x' }, { id: 'b', title: 'Two', durationSec: 200 }, { title: 'no id' }],
  },
});
await wait();
const q = last(remote, 'queue');
assert.equal(q.from, 'desk-0001');
assert.equal(q.queue.index, 1);
assert.deepEqual(q.queue.tracks.map((t) => t.id), ['a', 'b']);
assert.equal(q.queue.tracks[0].secret, undefined);

send(desk, { t: 'queue', queue: { index: 0, offset: 0, total: 1000, tracks: Array.from({ length: 1000 }, (_, i) => ({ id: `t${i}` })) } });
await wait();
assert.equal(last(remote, 'queue').queue.tracks.length, 300);

// someone joining later gets every player's latest queue in the welcome
const late = await connect('late-0001', 'web');
await wait();
assert.equal(last(late, 'welcome').queues['desk-0001'].tracks.length, 300);

// a remote is not a player: its "queue" is ignored
remote.inbox.length = 0;
send(late, { t: 'queue', queue: { index: 0, offset: 0, total: 1, tracks: [{ id: 'x' }] } });
await wait();
assert.equal(last(remote, 'queue'), undefined);

// a bad entry ends the window: later tracks are never shifted onto the wrong position
send(desk, { t: 'queue', queue: { index: 0, offset: 10, total: 20, tracks: [{ id: 'a' }, { nope: 1 }, { id: 'c' }] } });
await wait();
assert.deepEqual(last(remote, 'queue').queue.tracks.map((t) => t.id), ['a']);
assert.equal(last(remote, 'queue').queue.offset, 10);

// ---- browse ----
// the request reaches the player reduced to known fields; the answer goes back to whoever asked
send(remote, { t: 'browse', to: 'desk-0001', rid: 'r1', req: { kind: 'album', id: 'al-1', extra: 'dropped' } });
await wait();
const asked = last(desk, 'browse');
assert.deepEqual(asked.req, { kind: 'album', id: 'al-1' });
assert.equal(asked.from, 'remote-01');
assert.notEqual(asked.rid, 'r1', 'the player gets a relay id, not the remote\'s own');
send(desk, {
  t: 'browse-result', rid: asked.rid,
  result: { item: { id: 'al-1', name: 'Album', password: 'x' }, songs: [{ id: 's1', title: 'Song' }], junk: [1] },
});
await wait();
const answer = last(remote, 'browse-result');
assert.equal(answer.rid, 'r1');
assert.equal(answer.result.item.name, 'Album');
assert.equal(answer.result.item.password, undefined);
assert.equal(answer.result.junk, undefined);
assert.equal(answer.result.songs[0].title, 'Song');

// only the player that was asked may answer, and only once
late.inbox.length = 0;
send(late, { t: 'browse', to: 'desk-0001', rid: 'r2', req: { kind: 'playlists' } });
await wait();
const relay2 = last(desk, 'browse').rid;
send(remote, { t: 'browse-result', rid: relay2, result: { playlists: [{ id: 'fake' }] } });
await wait();
assert.equal(last(late, 'browse-result'), undefined, 'a device that was not asked cannot answer');
send(desk, { t: 'browse-result', rid: relay2, result: { playlists: [{ id: 'p1' }] } });
send(desk, { t: 'browse-result', rid: relay2, result: { playlists: [{ id: 'twice' }] } });
await wait();
assert.deepEqual(late.inbox.filter((m) => m.t === 'browse-result').map((m) => m.result.playlists[0].id), ['p1']);
assert.equal(last(late, 'browse-result').rid, 'r2', 'the answer carries the remote\'s own id');

// two remotes may use the same request id: each gets its own answer
remote.inbox.length = 0; late.inbox.length = 0; desk.inbox.length = 0;
send(remote, { t: 'browse', to: 'desk-0001', rid: 'same', req: { kind: 'playlists' } });
send(late, { t: 'browse', to: 'desk-0001', rid: 'same', req: { kind: 'artists', offset: 0 } });
await wait();
const asks = desk.inbox.filter((m) => m.t === 'browse');
assert.equal(asks.length, 2, 'neither request was refused as busy');
for (const a of asks) send(desk, { t: 'browse-result', rid: a.rid, result: { playlists: [{ id: a.from }] } });
await wait();
assert.equal(last(remote, 'browse-result').result.playlists[0].id, 'remote-01');
assert.equal(last(late, 'browse-result').result.playlists[0].id, 'late-0001');

// invalid requests are refused straight away
remote.inbox.length = 0;
send(remote, { t: 'browse', to: 'desk-0001', rid: 'r3', req: { kind: 'deleteEverything' } });
send(remote, { t: 'browse', to: 'desk-0001', rid: 'r4', req: { kind: 'search', query: '   ' } });
await wait();
assert.deepEqual(remote.inbox.filter((m) => m.t === 'browse-result').map((m) => m.error), ['bad_request', 'bad_request']);

// a remote cannot be asked to look things up: the request goes to a real player instead
desk.inbox.length = 0;
send(remote, { t: 'browse', to: 'late-0001', rid: 'r5', req: { kind: 'artists', offset: 200 } });
await wait();
assert.deepEqual(last(desk, 'browse').req, { kind: 'artists', offset: 200 });

// the player leaving mid-request fails the request instead of leaving it hanging
const desk2 = await connect('desk-0002', 'desktop');
await wait();
remote.inbox.length = 0;
send(remote, { t: 'browse', to: 'desk-0002', rid: 'r6', req: { kind: 'playlists' } });
await wait();
desk2.close();
await wait();
assert.equal(last(remote, 'browse-result').error, 'player_left');

// ---- artwork ----
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const auth = { authorization: `Bearer ${TOKEN}` };

// answer art requests from the player, counting how often it is asked
let artAsked = 0;
desk.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t !== 'art-request') return;
  artAsked++;
  if (m.coverArt === 'none') send(desk, { t: 'art', rid: m.rid });
  else if (m.coverArt === 'fake') send(desk, { t: 'art', rid: m.rid, mime: 'image/jpeg', data: Buffer.from('<svg onload=x>').toString('base64') });
  else send(desk, { t: 'art', rid: m.rid, mime: 'image/jpeg', data: JPEG.toString('base64') });
});

const r1 = await fetch(`http://127.0.0.1:${PORT}/api/art?id=al-1&size=150`, { headers: auth });
assert.equal(r1.status, 200);
assert.equal(r1.headers.get('content-type'), 'image/jpeg');
assert.deepEqual(Buffer.from(await r1.arrayBuffer()), JPEG);
const r2 = await fetch(`http://127.0.0.1:${PORT}/api/art?id=al-1&size=160`, { headers: auth });
assert.equal(r2.status, 200);
assert.equal(artAsked, 1, 'the same artwork at the same size comes from the cache');

assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/art?id=none`, { headers: auth })).status, 404);
assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/art?id=fake`, { headers: auth })).status, 404, 'not an image');
assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/art?id=al-1`)).status, 401, 'needs credentials');

// a player on another music server has its own artwork: the same cover id is asked for again, from it
const other = await new Promise<TestSocket>((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`) as TestSocket;
  ws.once('open', () => {
    ws.send(JSON.stringify({ t: 'hello', v: 1, token: TOKEN, deviceId: 'desk-other', name: 'other', kind: 'desktop', server: ['bbbbbbbb'] }));
    resolve(ws);
  });
});
let otherAsked = 0;
other.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t !== 'art-request') return;
  otherAsked++;
  send(other, { t: 'art', rid: m.rid, mime: 'image/jpeg', data: Buffer.concat([JPEG, Buffer.from([7])]).toString('base64') });
});
await wait();
send(other, { t: 'state', state: { trackId: 'x', playing: true } }); // the active player answers art requests
await wait();
const fromOther = await fetch(`http://127.0.0.1:${PORT}/api/art?id=al-1&size=150`, { headers: auth });
assert.equal(otherAsked, 1, 'another library does not reuse the first one\'s cached image');
assert.equal(Buffer.from(await fromOther.arrayBuffer()).length, JPEG.length + 1);

console.log('library tests passed');
srv.kill();
process.exit(0);
