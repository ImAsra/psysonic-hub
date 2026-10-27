// Web login (username + password from the environment), sessions, API tokens,
// failed-attempt throttling, and the cross-site checks.
import crypto from 'node:crypto';

const SESSION_IDLE_MS = 30 * 24 * 3600 * 1000; // sliding: unused sessions expire after 30 days
const SESSION_MAX_MS = 90 * 24 * 3600 * 1000; // absolute: nobody stays signed in forever
const MAX_SESSIONS = 50;
const MAX_TRACKED_IPS = 10_000;
export const COOKIE = 'hub_session';
export const COOKIE_SECURE = '__Host-hub_session'; // the __Host- prefix makes browsers insist on Secure + Path=/ + no Domain

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b)); // constant time, length-independent

export function createAuth(cfg) {
  const mode = cfg.password ? 'password' : 'token';
  const salt = crypto.randomBytes(16);
  const pwKey = cfg.password ? crypto.scryptSync(cfg.password, salt, 32) : null;
  const sessions = new Map(); // id -> { exp, born }
  const fails = new Map(); // ip -> { n, until, last }

  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (s.exp < now || now - s.born > SESSION_MAX_MS) sessions.delete(id);
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

  const cookieName = (req) => (isSecure(req) ? COOKIE_SECURE : COOKIE);

  const parseCookies = (header) => {
    const out = {};
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  };

  const alive = (s, now = Date.now()) => !!s && s.exp > now && now - s.born <= SESSION_MAX_MS;

  function sessionFromReq(req) {
    const id = parseCookies(req.headers.cookie)[cookieName(req)];
    const s = id && sessions.get(id);
    if (!s) return null;
    if (!alive(s)) { sessions.delete(id); return null; }
    s.exp = Date.now() + SESSION_IDLE_MS; // sliding
    return id;
  }

  // ---- failed-attempt throttling: logins, the device token, and API tokens share one budget per address ----
  /** Seconds this address is locked out for (0 = not locked). */
  const blockedFor = (req) => {
    const f = fails.get(clientIp(req));
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  };
  /** Record a failed attempt. `free` tries are forgiven before the lock starts (5 min, doubling up to 1 h). */
  function penalize(req, free = 4) {
    const ip = clientIp(req);
    const f = fails.get(ip);
    const n = (f?.n ?? 0) + 1;
    const lock = n > free ? Math.min(3600, 300 * 2 ** (n - free - 1)) * 1000 : 0;
    if (!f && fails.size >= MAX_TRACKED_IPS) fails.delete(fails.keys().next().value); // bounded memory
    fails.set(ip, { n, until: Date.now() + lock, last: Date.now() });
    return lock ? Math.ceil(lock / 1000) : 0;
  }
  const forgive = (req) => fails.delete(clientIp(req));

  async function login(user, password, req) {
    const wait = blockedFor(req);
    if (wait) return { ok: false, retryAfter: wait };
    // Always evaluate both parts so timing does not reveal which one was wrong.
    const key = await new Promise((resolve, reject) =>
      crypto.scrypt(String(password ?? ''), salt, 32, (e, k) => (e ? reject(e) : resolve(k))));
    const ok = same(user ?? '', cfg.user) & crypto.timingSafeEqual(key, pwKey);
    if (!ok) return { ok: false, retryAfter: penalize(req, 4) }; // 5th failure starts the lock
    forgive(req);
    const id = crypto.randomBytes(32).toString('base64url');
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    const now = Date.now();
    sessions.set(id, { exp: now + SESSION_IDLE_MS, born: now });
    return { ok: true, id };
  }

  const setCookie = (id, req) =>
    `${cookieName(req)}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_IDLE_MS / 1000}${isSecure(req) ? '; Secure' : ''}`;
  const clearCookie = (req) =>
    `${cookieName(req)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;

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
   * State-changing browser requests (login, logout) must come from this site's own page:
   * not a cross-site form post, and not text/plain (which a cross-site form CAN send).
   */
  function sameSitePost(req) {
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return { ok: false, status: 403 };
    if (req.headers.origin && !originOk(req)) return { ok: false, status: 403 };
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return { ok: false, status: 415 };
    return { ok: true };
  }

  /**
   * API access level for a request: 'full' | 'read' | null.
   * - Authorization: Bearer <API_TOKEN>            -> full
   * - Authorization: Bearer <API_TOKEN_READONLY>   -> read
   * - Authorization: Bearer <HUB_TOKEN>            -> read (it can already read everything over the WebSocket)
   * - ?key=<API_TOKEN_READONLY>                    -> read (for places that cannot send headers, e.g. a browser <img>)
   * - a valid web session cookie                   -> read (the page controls playback over the WebSocket)
   * `attempted` is true when credentials were presented but wrong (those count towards the lockout).
   */
  function apiLevel(req, url) {
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1];
    if (bearer) {
      if (cfg.apiToken && same(bearer, cfg.apiToken)) return { level: 'full' };
      if (cfg.apiTokenReadonly && same(bearer, cfg.apiTokenReadonly)) return { level: 'read' };
      if (same(bearer, cfg.token)) return { level: 'read' };
      return { level: null, attempted: true };
    }
    const key = url.searchParams.get('key');
    if (key) {
      if (cfg.apiTokenReadonly && same(key, cfg.apiTokenReadonly)) return { level: 'read' };
      return { level: null, attempted: true };
    }
    if (sessionFromReq(req)) return { level: 'read' };
    return { level: null, attempted: false };
  }

  return {
    mode, clientIp, isSecure, sessionFromReq, login, setCookie, clearCookie, originOk, sameSitePost, apiLevel,
    blockedFor, penalize, forgive,
    /** Ends the session of this request and returns its id (so its open sockets can be closed). */
    logout(req) {
      const id = parseCookies(req.headers.cookie)[cookieName(req)];
      if (id) sessions.delete(id);
      return id || null;
    },
    /** Still valid? (does not extend the session) */
    sessionActive: (id) => alive(sessions.get(id)),
    tokenOk: (t) => typeof t === 'string' && same(t, cfg.token),
  };
}
