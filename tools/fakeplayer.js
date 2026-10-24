// Fake second player for testing device switching without a phone app.
//   HUB_TOKEN=... node tools/fakeplayer.js [ws://127.0.0.1:5533/ws]
// It acts like a phone Psysonic: answers "yield" and "takeover", obeys commands,
// and reports state. Type commands in this terminal:
//   take    -> ask the hub to move playback HERE (desktop should pause + yield)
//   give    -> move playback back to the desktop
//   play    -> start "playing" locally (desktop should get told to pause)
//   pause   -> stop playing locally
import readline from 'node:readline';
import WebSocket from 'ws';

// A tiny solid-colour PNG, uploaded as the "cover" whenever this fake player starts playing.
import zlib from 'node:zlib';
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const makeCover = () => {
  const w = 64, rows = [];
  const [r, g, b] = [80 + Math.floor(Math.random() * 150), 80 + Math.floor(Math.random() * 150), 120 + Math.floor(Math.random() * 100)];
  for (let y = 0; y < w; y++) { const row = [0]; for (let x = 0; x < w; x++) row.push(r, g, Math.min(255, b + x)); rows.push(Buffer.from(row)); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(w, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
};

const url = process.argv[2] || 'ws://127.0.0.1:5533/ws';
const ME = 'fake-phone-0001';
const ws = new WebSocket(url);
let devices = [];
let track = { trackId: 'fake', title: '(fake track)', artist: 'Fake phone', durationSec: 240, volume: 0.5 };
let playing = false;
const LIST = ['Fake track 1', 'Fake track 2', 'Fake track 3', 'Fake track 4', 'Fake track 5'];
let idx = 0;
const setTrack = (i, title) => {
  idx = (i + LIST.length) % LIST.length;
  track = { ...track, trackId: 'fake-' + Date.now(), title: title ?? LIST[idx], artist: 'Fake phone', durationSec: 240 };
  pos = 0; posAt = Date.now();
};
let pos = 0;
let posAt = Date.now();

const send = (o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const nowPos = () => pos + (playing ? (Date.now() - posAt) / 1000 : 0);
let coverFor = '';
const report = () => {
  send({ t: 'state', state: { ...track, positionSec: nowPos(), playing } });
  if (playing && track.trackId && track.trackId !== coverFor) {
    coverFor = track.trackId;
    send({ t: 'cover', trackId: track.trackId, mime: 'image/png', data: makeCover().toString('base64') });
  }
};
const setPlaying = (v) => { pos = nowPos(); posAt = Date.now(); playing = v; report(); };
const log = (...a) => console.log(new Date().toLocaleTimeString(), ...a);

ws.on('open', () => send({ t: 'hello', v: 1, token: process.env.HUB_TOKEN, deviceId: ME, name: 'Fake phone', kind: 'phone' }));
ws.on('close', (c, r) => { log('closed', c, String(r)); process.exit(0); });
ws.on('message', (d) => {
  const m = JSON.parse(d);
  switch (m.t) {
    case 'welcome':
    case 'devices':
      devices = m.devices;
      log('devices:', devices.map((x) => `${x.name}${x.active ? ' ▶' : ''}`).join(' | '));
      break;
    case 'state':
      log(`desktop state: ${m.state.playing ? '▶' : '⏸'} ${m.state.artist} - ${m.state.title} @ ${Math.round(m.state.positionSec ?? 0)}s`);
      break;
    case 'yield':
      log('YIELD requested: pausing and confirming');
      setPlaying(false);
      send({ t: 'yielded', to: m.to });
      break;
    case 'takeover':
      log('TAKEOVER: I am the active player now. Last known state:', m.state && `${m.state.artist} - ${m.state.title} @ ${Math.round(m.state.positionSec ?? 0)}s`);
      if (m.fresh) {
        log('(fresh: a song was picked on another device; a real client would load the server queue)');
        setTrack(idx + 1, '(song picked on desktop)');
      } else if (m.state) {
        track = { ...track, ...m.state }; pos = (m.state.positionSec ?? 0) + (m.state.playing ? (m.ageMs ?? 0) / 1000 : 0);
      }
      posAt = Date.now();
      setPlaying(true);
      break;
    case 'command':
      log('COMMAND:', m.action, m.args ?? '');
      if (m.action === 'pause') setPlaying(false);
      if (m.action === 'play') setPlaying(true);
      if (m.action === 'toggle') setPlaying(!playing);
      if (m.action === 'next') { setTrack(idx + 1); report(); }
      if (m.action === 'prev') { if (nowPos() > 3) { pos = 0; posAt = Date.now(); } else setTrack(idx - 1); report(); }
      if (m.action === 'seek') { pos = Number(m.args?.positionSec) || 0; posAt = Date.now(); report(); }
      if (m.action === 'shuffle') { track = { ...track, shuffle: m.args?.value === true }; report(); }
      if (m.action === 'repeat') { track = { ...track, repeat: m.args?.value }; report(); }
      if (m.action === 'volume') { track = { ...track, volume: Number(m.args?.volume) }; report(); }
      break;
  }
});
setInterval(() => playing && report(), 5000);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const cmd = line.trim();
  const desk = devices.find((d) => d.kind === 'desktop');
  if (cmd === 'take') return send({ t: 'transfer', to: ME });
  if (cmd === 'give') return desk ? send({ t: 'transfer', to: desk.id }) : log('no desktop connected');
  if (cmd === 'play') return setPlaying(true);
  if (cmd === 'pause') return setPlaying(false);
  log('commands: take | give | play | pause');
});
