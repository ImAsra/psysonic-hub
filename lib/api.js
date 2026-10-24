// REST API for automations (Home Assistant, Stream Deck, shell scripts...) and a live event stream.
// It only translates requests into the same commands the apps use; it never touches your music server.
import { readJson } from './http.js';

const MAX_SSE = 20;
const RATE_PER_MIN = 600;

export function createApi({ hub, auth, cfg, baseHeaders }) {
  const sse = new Set();
  const rate = new Map(); // ip -> { n, reset }

  const cors = (req) => {
    const origin = req.headers.origin;
    return origin && cfg.corsOrigins.includes(origin)
      ? { 'access-control-allow-origin': origin, vary: 'Origin' }
      : {};
  };

  const json = (req, res, status, body, extra = {}) => {
    res.writeHead(status, {
      ...baseHeaders(), ...cors(req), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra,
    });
    res.end(JSON.stringify(body));
  };
  const fail = (req, res, status, error, extra) => json(req, res, status, { error }, extra);

  // ---- live event stream (SSE) ----
  let sseTimer = null;
  const pushSnapshot = () => {
    sseTimer = null;
    if (!sse.size) return;
    const data = JSON.stringify(hub.snapshot(cfg.publicUrl));
    for (const res of sse) res.write(`event: state\ndata: ${data}\n\n`);
  };
  hub.events.on('change', () => { if (!sseTimer && sse.size) sseTimer = setTimeout(pushSnapshot, 150); }); // coalesce bursts
  setInterval(() => { for (const res of sse) res.write(': ping\n\n'); }, 20_000).unref();

  function openStream(req, res) {
    if (sse.size >= MAX_SSE) return fail(req, res, 503, 'too_many_streams');
    res.writeHead(200, {
      ...baseHeaders(), ...cors(req), 'content-type': 'text/event-stream', 'cache-control': 'no-store',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    res.write(`retry: 3000\nevent: state\ndata: ${JSON.stringify(hub.snapshot(cfg.publicUrl))}\n\n`);
    sse.add(res);
    req.on('close', () => sse.delete(res));
  }

  // ---- routes ----
  const SIMPLE = new Set(['play', 'pause', 'toggle', 'next', 'prev']);

  /** Returns true if the request was handled. */
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...baseHeaders(), ...cors(req),
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type',
        'access-control-max-age': '600',
      });
      res.end();
      return true;
    }

    // rate limit per client address
    const ip = auth.clientIp(req);
    const now = Date.now();
    const r = rate.get(ip);
    if (!r || r.reset < now) rate.set(ip, { n: 1, reset: now + 60_000 });
    else if (++r.n > RATE_PER_MIN) {
      fail(req, res, 429, 'rate_limited', { 'retry-after': String(Math.ceil((r.reset - now) / 1000)) });
      return true;
    }

    const level = auth.apiLevel(req, url);
    if (!level) {
      fail(req, res, 401, 'unauthorized', { 'www-authenticate': 'Bearer' });
      return true;
    }
    const route = url.pathname.slice(5); // after /api/

    // ----- read access -----
    if (req.method === 'GET') {
      if (route === 'state') { json(req, res, 200, hub.snapshot(cfg.publicUrl)); return true; }
      if (route === 'devices') { json(req, res, 200, { devices: hub.snapshot().devices }); return true; }
      if (route === 'events') { openStream(req, res); return true; }
      if (route === 'cover') {
        const c = hub.getCover(url.searchParams.get('track') || '');
        if (!c) { fail(req, res, 404, 'no_cover'); return true; }
        if (req.headers['if-none-match'] === `"${c.etag}"`) {
          res.writeHead(304, { ...baseHeaders(), ...cors(req), etag: `"${c.etag}"` });
          res.end();
          return true;
        }
        res.writeHead(200, {
          ...baseHeaders(), ...cors(req), 'content-type': c.mime, 'content-length': c.buf.length,
          etag: `"${c.etag}"`, 'cache-control': 'private, max-age=60',
        });
        res.end(c.buf);
        return true;
      }
      fail(req, res, 404, 'not_found');
      return true;
    }

    // ----- control access (needs API_TOKEN) -----
    if (req.method !== 'POST') { fail(req, res, 405, 'method_not_allowed', { allow: 'GET, POST, OPTIONS' }); return true; }
    if (level !== 'full') { fail(req, res, 403, 'read_only_credentials'); return true; }

    let body;
    try { body = await readJson(req); } catch (e) {
      const big = e.message === 'too_large';
      fail(req, res, big ? 413 : 400, big ? 'too_large' : 'bad_json', big ? { connection: 'close' } : {});
      return true;
    }
    const device = typeof body.device === 'string' ? body.device : undefined;
    const reply = (out) => { const { status, ...rest } = out; json(req, res, status, rest); return true; };

    if (route === 'command') return reply(hub.apiCommand(String(body.action), body.args, device));
    if (route === 'transfer') return reply(hub.apiTransfer(device));
    if (SIMPLE.has(route)) return reply(hub.apiCommand(route, null, device));
    if (route === 'seek') return reply(hub.apiCommand('seek', body, device));
    if (route === 'volume') return reply(hub.apiCommand('volume', body, device));
    if (route === 'shuffle') return reply(hub.apiCommand('shuffle', body, device));
    if (route === 'repeat') return reply(hub.apiCommand('repeat', body, device));

    fail(req, res, 404, 'not_found');
    return true;
  }

  return { handle };
}
