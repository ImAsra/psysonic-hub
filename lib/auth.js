// Web login (username + password from the environment), sessions, API tokens,
// login rate limiting, and the cross-site WebSocket check.
import crypto from 'node:crypto';

const SESSION_MS = 30 * 24 * 3600 * 1000; // sliding
const MAX_SESSIONS = 50;
export const COOKIE = 'hub_session';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b)); // constant time, length-independent

export function createAuth(cfg) {
  const mode = cfg.password ? 'password' : 'token';
  const salt = crypto.randomBytes(16);
  const pwKey = cfg.password ? crypto.scryptSync(cfg.password, salt, 32) : null;
  const sessions = new Map(); // id -> { exp }
  const fails = new Map(); // ip -> { n, until, last }

  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (s.exp < now) sessions.delete(id);
    for (const [ip, f] of fails) if (f.until < now && now - f.last > 3600 * 1000) fails.delete(ip);
  }, 60_000).unref();

  const clientIp = (req) => {
    if (cfg.trustProxy) {
      // Behind one reverse proxy the LAST entry is the one the proxy added (earlier ones are client-controlled).
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const isSecure = (req) =>
    Boolean(req.socket.encrypted) || (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https');

  const parseCookies = (header) => {
    const out = {};
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  };

  function sessionFromReq(req) {
    const id = parseCookies(req.headers.cookie)[COOKIE];
    const s = id && sessions.get(id);
    if (!s) return null;
    if (s.exp < Date.now()) { sessions.delete(id); return null; }
    s.exp = Date.now() + SESSION_MS; // sliding
    return id;
  }

  async function login(user, password, req) {
    const ip = clientIp(req);
    const f = fails.get(ip);
    if (f && f.until > Date.now()) return { ok: false, retryAfter: Math.ceil((f.until - Date.now()) / 1000) };

    // Always evaluate both parts so timing does not reveal which one was wrong.
    const key = await new Promise((resolve, reject) =>
      crypto.scrypt(String(password ?? ''), salt, 32, (e, k) => (e ? reject(e) : resolve(k))));
    const ok = same(user ?? '', cfg.user) & crypto.timingSafeEqual(key, pwKey);

    if (!ok) {
      const n = (f?.n ?? 0) + 1;
      // 5 free tries, then 5 min, doubling up to 1 h.
      const lock = n >= 5 ? Math.min(3600, 300 * 2 ** (n - 5)) * 1000 : 0;
      fails.set(ip, { n, until: Date.now() + lock, last: Date.now() });
      return { ok: false, retryAfter: lock ? Math.ceil(lock / 1000) : 0 };
    }
    fails.delete(ip);
    const id = crypto.randomBytes(32).toString('base64url');
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    sessions.set(id, { exp: Date.now() + SESSION_MS });
    return { ok: true, id };
  }

  const setCookie = (id, req) =>
    `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${isSecure(req) ? '; Secure' : ''}`;
  const clearCookie = (req) =>
    `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;

  /** Browsers always send Origin on a WebSocket handshake: it must be this site (or allowed). */
  function originOk(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser
    if (cfg.allowedOrigins.includes(origin)) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch { return false; }
  }

  /**
   * API access level for a request: 'full' | 'read' | null.
   * - Authorization: Bearer <API_TOKEN>            -> full
   * - Authorization: Bearer <API_TOKEN_READONLY>   -> read
   * - Authorization: Bearer <HUB_TOKEN>            -> read (it can already read everything over the WebSocket)
   * - ?key=<API_TOKEN_READONLY>                    -> read (for places that cannot send headers, e.g. a browser <img>)
   * - a valid web session cookie                   -> read (the page controls playback over the WebSocket)
   */
  function apiLevel(req, url) {
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
    if (bearer) {
      if (cfg.apiToken && same(bearer, cfg.apiToken)) return 'full';
      if (cfg.apiTokenReadonly && same(bearer, cfg.apiTokenReadonly)) return 'read';
      if (same(bearer, cfg.token)) return 'read';
      return null;
    }
    const key = url.searchParams.get('key');
    if (key && cfg.apiTokenReadonly && same(key, cfg.apiTokenReadonly)) return 'read';
    if (sessionFromReq(req)) return 'read';
    return null;
  }

  return {
    mode, clientIp, isSecure, sessionFromReq, login, setCookie, clearCookie, originOk, apiLevel,
    /** Ends the session of this request and returns its id (so its open sockets can be closed). */
    logout(req) {
      const id = parseCookies(req.headers.cookie)[COOKIE];
      if (id) sessions.delete(id);
      return id || null;
    },
    /** Still valid? (does not extend the session) */
    sessionActive: (id) => { const s = sessions.get(id); return !!s && s.exp > Date.now(); },
    tokenOk: (t) => typeof t === 'string' && same(t, cfg.token),
  };
}
