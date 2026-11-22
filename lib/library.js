// Library browsing for remotes, relayed through a player.
// The hub never talks to the music server: a remote asks, a connected player looks it up
// on its own music server and answers, and the hub passes the answer back. Artwork for the
// library pages is fetched the same way and kept in a small in-memory cache.
import crypto from 'node:crypto';

export const BROWSE_KINDS = new Set(['albums', 'search', 'album', 'artist', 'artists', 'playlists', 'playlist']);
const ALBUM_SORTS = new Set(['newest', 'recent', 'frequent', 'random', 'alphabeticalByName', 'alphabeticalByArtist', 'starred']);
const BROWSE_TIMEOUT_MS = 15_000;
const MAX_PENDING_PER_DEVICE = 20;
const LIST_MAX = 500;

const ART_TIMEOUT_MS = 10_000;
const ART_MAX_BYTES = 256 * 1024;
const ART_CACHE_BYTES = 48 * 1024 * 1024;
export const ART_SIZES = [96, 160, 300, 600];
// A Map, not an object: a client-supplied type like "__proto__" must never resolve to a function.
const ART_TYPES = new Map([
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['image/webp', (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'],
]);

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : undefined);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
const isRid = (v) => typeof v === 'string' && /^[\w-]{1,40}$/.test(v);

/** A browse request from a remote, reduced to what the player needs. Returns null when invalid. */
export function cleanBrowseRequest(r) {
  if (!r || typeof r !== 'object' || !BROWSE_KINDS.has(r.kind)) return null;
  const out = { kind: r.kind };
  if (r.kind === 'album' || r.kind === 'artist' || r.kind === 'playlist') {
    if (!isId(r.id)) return null;
    out.id = r.id;
  }
  if (r.kind === 'search') {
    const q = str(r.query, 100)?.trim();
    if (!q) return null;
    out.query = q;
  }
  if (r.kind === 'albums') out.sort = ALBUM_SORTS.has(r.sort) ? r.sort : 'newest';
  if (r.kind === 'albums' || r.kind === 'artists') out.offset = Math.floor(num(r.offset, 0, 100_000) ?? 0);
  return out;
}

/** One album, artist, song or playlist in an answer: only known fields, bounded. */
function cleanItem(it) {
  if (!it || typeof it !== 'object' || !isId(it.id)) return null;
  const out = {
    id: it.id, name: str(it.name, 300), title: str(it.title, 300), artist: str(it.artist, 300), artistId: str(it.artistId),
    album: str(it.album, 300), albumId: str(it.albumId), coverArt: str(it.coverArt),
    year: num(it.year, 0, 9999), durationSec: num(it.durationSec, 0, 1e7), songCount: num(it.songCount, 0, 1e6),
    albumCount: num(it.albumCount, 0, 1e6), track: num(it.track, 0, 1e5), disc: num(it.disc, 0, 1e3),
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
const cleanList = (v) => (Array.isArray(v) ? v.slice(0, LIST_MAX).map(cleanItem).filter(Boolean) : undefined);

/** A player's answer: an optional header item plus lists. Everything else is dropped. */
export function cleanBrowseResult(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const out = {
    item: r.item ? cleanItem(r.item) ?? undefined : undefined,
    albums: cleanList(r.albums), artists: cleanList(r.artists), songs: cleanList(r.songs), playlists: cleanList(r.playlists),
    more: r.more === true ? true : undefined,
  };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

const artSize = (v) => {
  const n = Number(v);
  return ART_SIZES.find((s) => s >= n) ?? ART_SIZES[ART_SIZES.length - 1];
};

export function createLibrary({ hub }) {
  // Keyed by a relay id the hub picks, so two remotes may use the same request ids; each keeps its own `rid`.
  const browsePending = new Map(); // relayId -> { from, rid, to, timer }
  const artPending = new Map(); // rid -> { key, to, waiters, timer }
  const artByKey = new Map(); // key -> rid of the request in flight
  const artCache = new Map(); // key -> { mime, buf, etag }; insertion order = least recently used first
  let artBytes = 0;

  const pendingFrom = (from) => [...browsePending.values()].filter((p) => p.from === from).length;

  const pendingRid = (from, rid) => [...browsePending.values()].some((p) => p.from === from && p.rid === rid);

  /** A remote asks `to` (or any player) to look something up. Answers arrive as `browse-result`. */
  function browse(fromId, to, rid, rawReq) {
    const fail = (error) => hub.notify(fromId, { t: 'browse-result', rid, error });
    if (!isRid(rid)) return false;
    const req = cleanBrowseRequest(rawReq);
    if (!req) return fail('bad_request');
    const target = to && hub.isPlayer(to) ? to : hub.anyPlayer();
    if (!target) return fail('no_player');
    if (pendingRid(fromId, rid) || pendingFrom(fromId) >= MAX_PENDING_PER_DEVICE) return fail('busy');
    const relayId = crypto.randomBytes(9).toString('base64url');
    const timer = setTimeout(() => {
      browsePending.delete(relayId);
      fail('timeout');
    }, BROWSE_TIMEOUT_MS);
    browsePending.set(relayId, { from: fromId, rid, to: target, timer });
    hub.notify(target, { t: 'browse', rid: relayId, from: fromId, req });
    return true;
  }

  /** A player's answer (`rid` is the relay id it was sent): only accepted from the player that was asked. */
  function browseResult(id, relayId, rawResult, error) {
    const p = isRid(relayId) && browsePending.get(relayId);
    if (!p || p.to !== id) return false;
    clearTimeout(p.timer);
    browsePending.delete(relayId);
    const result = error ? null : cleanBrowseResult(rawResult);
    hub.notify(p.from, result
      ? { t: 'browse-result', rid: p.rid, from: id, result }
      : { t: 'browse-result', rid: p.rid, from: id, error: typeof error === 'string' ? error.slice(0, 40) : 'bad_result' });
    return true;
  }

  // ---- artwork ----
  const cacheGet = (key) => {
    const hit = artCache.get(key);
    if (hit) { artCache.delete(key); artCache.set(key, hit); } // most recently used goes last
    return hit ?? null;
  };
  const cachePut = (key, art) => {
    if (artCache.has(key)) artBytes -= artCache.get(key).buf.length;
    artCache.set(key, art);
    artBytes += art.buf.length;
    for (const [k, v] of artCache) {
      if (artBytes <= ART_CACHE_BYTES) break;
      artCache.delete(k);
      artBytes -= v.buf.length;
    }
  };

  /**
   * Which library a player's cover ids belong to: its music server + account (shared by players on the
   * same account), or the player itself when it did not say. The same id on another server is another image.
   */
  const libraryOf = (playerId) => {
    const keys = hub.serverKeys(playerId);
    return keys.length ? [...keys].sort().join(',') : `device:${playerId}`;
  };

  /** Artwork for a cover art id. Resolves to { mime, buf, etag } or null (no player, timeout, no art). */
  function getArt(coverArt, size) {
    if (!isId(coverArt)) return Promise.resolve(null);
    const to = hub.anyPlayer();
    if (!to) return Promise.resolve(null);
    const px = artSize(size);
    const key = `${libraryOf(to)}|${px}:${coverArt}`;
    const hit = cacheGet(key);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => {
      const inFlight = artByKey.get(key);
      if (inFlight && artPending.has(inFlight)) {
        artPending.get(inFlight).waiters.push(resolve);
        return;
      }
      const rid = crypto.randomBytes(9).toString('base64url');
      const done = (art) => {
        const p = artPending.get(rid);
        if (!p) return;
        clearTimeout(p.timer);
        artPending.delete(rid);
        artByKey.delete(key);
        for (const w of p.waiters) w(art);
      };
      artPending.set(rid, { key, to, waiters: [resolve], timer: setTimeout(() => done(null), ART_TIMEOUT_MS), done });
      artByKey.set(key, rid);
      hub.notify(to, { t: 'art-request', rid, coverArt, size: px });
    });
  }

  /** A player sends the artwork it was asked for (`data` empty or missing = it has none). */
  function artReceived(id, msg) {
    const p = msg && isRid(msg.rid) && artPending.get(msg.rid);
    if (!p || p.to !== id) return false;
    const { mime, data } = msg;
    const check = typeof mime === 'string' && ART_TYPES.get(mime);
    let art = null;
    if (check && typeof data === 'string' && data.length <= ART_MAX_BYTES * 1.4) {
      const buf = Buffer.from(data, 'base64');
      if (buf.length >= 16 && buf.length <= ART_MAX_BYTES && check(buf)) {
        art = { mime, buf, etag: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) };
        cachePut(p.key, art);
      }
    }
    p.done(art);
    return true;
  }

  /** A device left: requests it was answering fail now instead of at their timeout. */
  function deviceLeft(id) {
    for (const [relayId, p] of browsePending) {
      if (p.to !== id && p.from !== id) continue;
      clearTimeout(p.timer);
      browsePending.delete(relayId);
      if (p.to === id) hub.notify(p.from, { t: 'browse-result', rid: p.rid, error: 'player_left' });
    }
    for (const p of [...artPending.values()]) if (p.to === id) p.done(null);
  }

  return { browse, browseResult, getArt, artReceived, deviceLeft };
}
