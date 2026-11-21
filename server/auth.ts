// Web login (username + password from the environment), sessions, API tokens,
// failed-attempt throttling, and the cross-site checks.
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import type { Config } from './config.ts';

export type ApiLevel = 'full' | 'read' | null;
interface Session { exp: number; born: number }
interface Fail { n: number; until: number; last: number }

const SESSION_IDLE_MS = 30 * 24 * 3600 * 1000; // sliding: unused sessions expire after 30 days
const SESSION_MAX_MS = 90 * 24 * 3600 * 1000; // absolute: nobody stays signed in forever
const MAX_SESSIONS = 50;
const MAX_TRACKED_IPS = 10_000;
const MAX_CHECKS_PER_IP = 2; // password checks (scrypt) running at once for one address
const MAX_CHECKS_TOTAL = 6; // ...and for the whole hub, so a flood cannot burn the CPU
export const COOKIE = 'hub_session';
export const COOKIE_SECURE = '__Host-hub_session'; // the __Host- prefix makes browsers insist on Secure + Path=/ + no Domain

const sha = (s: unknown) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a: unknown, b: unknown) => crypto.timingSafeEqual(sha(a), sha(b)); // constant time, length-independent

export function createAuth(cfg: Config) {
  const mode = cfg.password ? 'password' : 'token';
  const salt = crypto.randomBytes(16);
  const pwKey = cfg.password ? crypto.scryptSync(cfg.password, salt, 32) : null;
  const sessions = new Map<string, Session>();
  const fails = new Map<string, Fail>(); // by client address
  let checksRunning = 0;
  const checksByIp = new Map<string, number>();

  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (s.exp < now || now - s.born > SESSION_MAX_MS) sessions.delete(id);
    for (const [ip, f] of fails) if (f.until < now && now - f.last > 3600 * 1000) fails.delete(ip);
  }, 60_000).unref();

  const clientIp = (req: IncomingMessage): string => {
    if (cfg.trustProxy) {
      // Behind one reverse proxy the LAST entry is the one the proxy added (earlier ones are client-controlled).
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || 'unknown';
  };

  const isSecure = (req: IncomingMessage): boolean =>
    Boolean((req.socket as TLSSocket).encrypted) || (cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https');

  const cookieName = (req: IncomingMessage) => (isSecure(req) ? COOKIE_SECURE : COOKIE);

  const parseCookies = (header: string | undefined) => {
    const out: Record<string, string> = {};
    for (const part of String(header || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  };

  const alive = (s: Session | undefined, now = Date.now()) => !!s && s.exp > now && now - s.born <= SESSION_MAX_MS;

  function sessionFromReq(req: IncomingMessage): string | null {
    const id = parseCookies(req.headers.cookie)[cookieName(req)];
    const s = id && sessions.get(id);
    if (!s) return null;
    if (!alive(s)) { sessions.delete(id); return null; }
    s.exp = Date.now() + SESSION_IDLE_MS; // sliding
    return id;
  }

  // ---- failed-attempt throttling: logins, the device token, and API tokens share one budget per address ----
  /** Seconds this address is locked out for (0 = not locked). */
  const blockedFor = (req: IncomingMessage): number => {
    const f = fails.get(clientIp(req));
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  };
  /** Record a failed attempt. `free` tries are forgiven before the lock starts (5 min, doubling up to 1 h). */
  function penalize(req: IncomingMessage, free = 4): number {
    const ip = clientIp(req);
    const f = fails.get(ip);
    const n = (f?.n ?? 0) + 1;
    const lock = n > free ? Math.min(3600, 300 * 2 ** (n - free - 1)) * 1000 : 0;
    if (!f && fails.size >= MAX_TRACKED_IPS) fails.delete(fails.keys().next().value!); // bounded memory
    fails.set(ip, { n, until: Date.now() + lock, last: Date.now() });
    return lock ? Math.ceil(lock / 1000) : 0;
  }
  const forgive = (req: IncomingMessage) => fails.delete(clientIp(req));

  async function login(
    user: unknown, password: unknown, req: IncomingMessage,
  ): Promise<{ ok: true; id: string } | { ok: false; retryAfter: number }> {
    const wait = blockedFor(req);
    if (wait) return { ok: false, retryAfter: wait };
    // Only a couple of password checks may run at once (each one is deliberately slow).
    const ip = clientIp(req);
    if (checksRunning >= MAX_CHECKS_TOTAL || (checksByIp.get(ip) ?? 0) >= MAX_CHECKS_PER_IP) {
      return { ok: false, retryAfter: 1 }; // busy: not counted as a guess
    }
    // The attempt is counted NOW, before the slow check. Counting only after it finished let a burst of
    // parallel requests all pass the lock check first, so the lock never applied to them.
    // (The 5th attempt starts the lock; a correct password still signs in and clears it.)
    const lockStartedByThis = penalize(req, 4);
    const ownLock = lockStartedByThis ? fails.get(ip)?.until : 0;
    checksRunning++;
    checksByIp.set(ip, (checksByIp.get(ip) ?? 0) + 1);
    try {
      // Always evaluate both parts so timing does not reveal which one was wrong.
      const key = await new Promise<Buffer>((resolve, reject) =>
        crypto.scrypt(String(password ?? ''), salt, 32, (e, k) => (e ? reject(e) : resolve(k))));
      // If a DIFFERENT request locked this address while the check ran, refuse this one too, even with the right
      // password (a locked address signs nobody in, and a late success must not wipe the lock). The lock that
      // this very attempt started does not count: the 5th try is still a real try.
      const lock = fails.get(ip);
      if (lock && lock.until > Date.now() && lock.until !== ownLock) {
        return { ok: false, retryAfter: Math.ceil((lock.until - Date.now()) / 1000) };
      }
      const ok = Number(same(user ?? '', cfg.user)) & Number(crypto.timingSafeEqual(key, pwKey!));
      if (!ok) return { ok: false, retryAfter: lockStartedByThis || blockedFor(req) };
      forgive(req);
      const id = crypto.randomBytes(32).toString('base64url');
      if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      const now = Date.now();
      sessions.set(id, { exp: now + SESSION_IDLE_MS, born: now });
      return { ok: true, id };
    } finally {
      checksRunning--;
      const n = (checksByIp.get(ip) ?? 1) - 1;
      if (n <= 0) checksByIp.delete(ip); else checksByIp.set(ip, n);
    }
  }

  const setCookie = (id: string, req: IncomingMessage) =>
    `${cookieName(req)}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_IDLE_MS / 1000}${isSecure(req) ? '; Secure' : ''}`;
  const clearCookie = (req: IncomingMessage) =>
    `${cookieName(req)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isSecure(req) ? '; Secure' : ''}`;

  /** Browsers always send Origin on a WebSocket handshake: it must be this site (or allowed). */
  function originOk(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true; // not a browser
    if (cfg.allowedOrigins.includes(origin)) return true;

    try {
      const expectedProtocol = isSecure(req) ? 'https:' : 'http:';
      const actualOrigin = new URL(origin);
      const expectedOrigin = new URL(`${expectedProtocol}//${req.headers.host}`);

      return actualOrigin.origin === expectedOrigin.origin;
    } catch {
      return false;
    }
  }

  /**
   * State-changing browser requests (login, logout) must come from this site's own page:
   * not a cross-site form post, and not text/plain (which a cross-site form CAN send).
   */
  function sameSitePost(req: IncomingMessage): { ok: true } | { ok: false; status: number } {
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
  function apiLevel(req: IncomingMessage, url: URL): { level: ApiLevel; attempted?: boolean } {
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
    logout(req: IncomingMessage): string | null {
      const id = parseCookies(req.headers.cookie)[cookieName(req)];
      if (id) sessions.delete(id);
      return id || null;
    },
    /** Still valid? (does not extend the session) */
    sessionActive: (id: string) => alive(sessions.get(id)),
    tokenOk: (t: unknown) => typeof t === 'string' && same(t, cfg.token),
  };
}
