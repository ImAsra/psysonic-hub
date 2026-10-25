// psysonic-hub: optional self-hosted realtime hub (Spotify Connect style).
// Relays state + commands between a user's own devices. Never touches audio and
// never talks to your music server. See README.md and docs/.
import http from 'node:http';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { loadConfig } from './lib/config.js';
import { createAuth } from './lib/auth.js';
import { createHub, PROTOCOL } from './lib/core.js';
import { createApi } from './lib/api.js';
import { baseHeaders, readJson, sendJson } from './lib/http.js';

const { cfg, errors } = loadConfig();
if (errors.length) {
  for (const e of errors) console.error(e);
  process.exit(1);
}

const auth = createAuth(cfg);
const hub = createHub({
  dataDir: cfg.dataDir, maxDevices: cfg.maxDevices, serverCheck: cfg.serverCheck, yieldTimeoutMs: cfg.yieldTimeoutMs,
});

process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e));
const api = createApi({ hub, auth, cfg, baseHeaders });

const HELLO_TIMEOUT_MS = 5000;
const PING_MS = 30000;

// ---- static files: fixed routes only (no filesystem path ever comes from a request) ----
const readPublic = (f) => fs.readFileSync(new URL(`./public/${f}`, import.meta.url));
const PAGE = readPublic('index.html');
const MANIFEST = JSON.stringify({
  name: 'Psysonic Remote', short_name: 'Remote', start_url: '/', display: 'standalone',
  background_color: '#1e1e2e', theme_color: '#181825',
  icons: [{ src: '/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
});
const BRAND = { '/logo.svg': 'image/svg+xml', '/icon.png': 'image/png' }; // optional files you add to ./public

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://hub');
  const route = url.pathname;
  try {
    if (req.method === 'GET' && route === '/') {
      res.writeHead(200, { ...baseHeaders(), 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(PAGE);
    }
    if (req.method === 'GET' && BRAND[route]) {
      return fs.readFile(new URL(`./public${route}`, import.meta.url), (err, data) => {
        if (err) return res.writeHead(404, baseHeaders()).end();
        res.writeHead(200, { ...baseHeaders(), 'content-type': BRAND[route], 'cache-control': 'public, max-age=3600' });
        res.end(data);
      });
    }
    if (req.method === 'GET' && route === '/manifest.webmanifest') {
      res.writeHead(200, { ...baseHeaders(), 'content-type': 'application/manifest+json' });
      return res.end(MANIFEST);
    }
    if (req.method === 'GET' && route === '/health') return sendJson(res, 200, { ok: true, protocol: PROTOCOL });

    // ---- web login ----
    if (route === '/auth/config' && req.method === 'GET') return sendJson(res, 200, { mode: auth.mode });
    if (route === '/auth/me' && req.method === 'GET') {
      return auth.sessionFromReq(req) ? sendJson(res, 200, { ok: true }) : sendJson(res, 401, { error: 'unauthorized' });
    }
    if (route === '/auth/login' && req.method === 'POST') {
      if (auth.mode !== 'password') return sendJson(res, 404, { error: 'login_disabled' });
      let body;
      try { body = await readJson(req, 2048); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
      const out = await auth.login(body.user, body.password, req);
      if (!out.ok) {
        console.warn(`[auth] failed login from ${auth.clientIp(req)}`);
        return out.retryAfter
          ? sendJson(res, 429, { error: 'too_many_attempts', retryAfter: out.retryAfter }, { 'retry-after': String(out.retryAfter) })
          : sendJson(res, 401, { error: 'invalid_credentials' });
      }
      return sendJson(res, 200, { ok: true }, { 'set-cookie': auth.setCookie(out.id, req) });
    }
    if (route === '/auth/logout' && req.method === 'POST') {
      const sid = auth.logout(req);
      // Signing out also ends the page's open WebSocket(s); a socket must not outlive its session.
      if (sid) for (const c of wss.clients) if (c.sessionId === sid) c.close(4005, 'signed out');
      return sendJson(res, 200, { ok: true }, { 'set-cookie': auth.clearCookie(req) });
    }

    if (await api.handle(req, res, url)) return;
    res.writeHead(404, baseHeaders()).end();
  } catch (e) {
    console.error('request failed:', e);
    if (!res.headersSent) res.writeHead(500, baseHeaders());
    res.end();
  }
});

// ---- WebSocket: the apps (HUB_TOKEN) and the web page (login session) ----
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 }); // room for a cover image

wss.on('connection', (ws, req) => {
  // A browser session counts only for this site's own pages (cross-site WebSocket hijacking guard).
  const sessionId = auth.mode === 'password' ? auth.sessionFromReq(req) : null;
  const sessionOk = !!sessionId && auth.originOk(req);
  let id = null;
  let remoteOnly = false; // web remotes can control devices but are not players
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  const helloTimer = setTimeout(() => ws.close(4001, 'hello timeout'), HELLO_TIMEOUT_MS);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return ws.close(4002, 'bad json'); }
    if (!m || typeof m.t !== 'string') return;

    // ---- handshake ----
    if (!id) {
      if (m.t !== 'hello') return ws.close(4003, 'hello first');
      if (m.v !== PROTOCOL) return ws.close(4004, 'unsupported protocol');
      const byToken = auth.tokenOk(m.token);
      if (!byToken && !sessionOk) return ws.close(4005, 'unauthorized');
      if (typeof m.deviceId !== 'string' || !/^[\w-]{4,64}$/.test(m.deviceId)) return ws.close(4006, 'bad deviceId');
      const kind = !byToken ? 'web' : m.kind; // a session login is always a web remote
      const joined = hub.join(m.deviceId, { ws, name: m.name, kind, server: m.server });
      if (joined.error) return ws.close(4007, joined.error);
      clearTimeout(helloTimer);
      id = m.deviceId;
      remoteOnly = kind === 'web';
      if (!byToken) ws.sessionId = sessionId; // tied to the login session: ends when it ends
      return;
    }

    try {
      switch (m.t) {
        case 'state': // players only
          if (remoteOnly || !m.state || typeof m.state !== 'object') return;
          return hub.reportState(id, m.state);
        case 'command':
          return void hub.command(m.to, m.action, m.args, id);
        case 'transfer': {
          const out = hub.transfer(m.to, id, m.fresh === true);
          if (out.error) hub.send(ws, { t: 'transfer-failed', to: m.to, reason: out.error });
          return;
        }
        case 'yielded': // players only; ok:false = the queue could not be saved
          if (remoteOnly) return;
          return hub.yielded(id, m.ok !== false, typeof m.reason === 'string' ? m.reason.slice(0, 40) : undefined);
        case 'takeover-failed':
          return remoteOnly ? undefined : hub.takeoverFailed(id, m.reason);
        case 'server': // the user switched music server/account on this device
          return remoteOnly ? undefined : hub.setServer(id, m.server);
        case 'queue-changed': // only to devices that share this device's music server + account
          return remoteOnly ? undefined : hub.relayToCompatible(id, { t: 'queue-changed', from: id });
        case 'cover':
          return remoteOnly ? undefined : void hub.setCover(id, m);
        case 'settings': {
          if (remoteOnly) return;
          const cat = hub.updateSettings(m, ws);
          return cat ? hub.relaySettings(cat, hub.sharedSettings[cat], id) : undefined;
        }
        case 'sync-config':
          return void hub.setSyncConfig(m.category, m.enabled);
        case 'ping':
          return hub.send(ws, { t: 'pong' });
      }
    } catch (e) {
      // One malformed message must never take the whole hub down.
      console.error('message handler failed:', e);
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (id) hub.leave(id, ws);
  });
  ws.on('error', () => {});
});

// Drop dead connections (phones losing signal etc.)
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.sessionId && !auth.sessionActive(ws.sessionId)) { ws.close(4005, 'session ended'); continue; }
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, PING_MS).unref();

server.listen(cfg.port, () => {
  const apiOn = cfg.apiToken || cfg.apiTokenReadonly ? 'tokens set' : 'no tokens (session only)';
  console.log(`psysonic-hub listening on :${cfg.port} (protocol v${PROTOCOL}, web login: ${auth.mode}, api: ${apiOn})`);
});
