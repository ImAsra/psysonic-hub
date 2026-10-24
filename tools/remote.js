// Tiny CLI remote for testing the hub without a phone app.
//   HUB_TOKEN=... node tools/remote.js [ws://127.0.0.1:5533/ws]
// Commands: toggle | play | pause | next | prev | seek 1:30 | seek 90 | seek +10 | seek -10 | vol 0.5 | devices
import readline from 'node:readline';
import WebSocket from 'ws';

const url = process.argv[2] || 'ws://127.0.0.1:5533/ws';
const ws = new WebSocket(url);
const me = 'cli-remote';
let devices = [];
let last = null; // last state seen, for relative seeks
const parseTime = (a) => (a.includes(':') ? a.split(':').reduce((t, n) => t * 60 + Number(n), 0) : Number(a));

const target = () => (devices.find((d) => d.active && d.id !== me) ?? devices.find((d) => d.id !== me))?.id;
const send = (o) => ws.send(JSON.stringify(o));

ws.on('open', () => send({ t: 'hello', v: 1, token: process.env.HUB_TOKEN, deviceId: me, name: 'CLI remote', kind: 'web' }));
ws.on('close', (c, r) => { console.log('closed', c, String(r)); process.exit(0); });
ws.on('message', (d) => {
  const m = JSON.parse(d);
  if (m.t === 'welcome' || m.t === 'devices') {
    devices = m.devices;
    console.log('devices:', devices.map((x) => `${x.name}${x.active ? ' ▶' : ''}`).join(' | '));
  }
  if (m.t === 'state' || (m.t === 'welcome' && m.state)) {
    const s = m.state;
    last = { ...s, at: Date.now() };
    console.log(`state: ${s.playing ? '▶' : '⏸'} ${s.artist} - ${s.title} @ ${Math.round(s.positionSec ?? 0)}s vol ${s.volume}`);
  }
});

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const [cmd, arg] = line.trim().split(/\s+/);
  const to = target();
  if (cmd === 'devices') return console.log(devices);
  if (!to) return console.log('no other device connected');
  let args = null;
  if (cmd === 'vol') args = { volume: Number(arg) };
  if (cmd === 'seek') {
    if (!arg) return console.log('usage: seek 1:30 | seek 90 | seek +10 | seek -10');
    const rel = arg[0] === '+' || arg[0] === '-';
    let sec = parseTime(rel ? arg.slice(1) : arg);
    if (rel) {
      const now = (last?.positionSec ?? 0) + (last?.playing ? (Date.now() - last.at) / 1000 : 0);
      sec = now + (arg[0] === '-' ? -sec : sec);
    }
    args = { positionSec: Math.max(0, sec) };
  }
  send({ t: 'command', to, action: cmd === 'vol' ? 'volume' : cmd, args });
});
