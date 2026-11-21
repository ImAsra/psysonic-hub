import { fetchImage } from './fetchImage.ts';

// Library artwork stays loaded for the whole visit: object URLs by "player|size:coverArt". The player is
// part of the key because the same cover id from another player's library is another image.
const loaded = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();

const keyOf = (player: string, coverArt: string, size: number) => `${player}|${size}:${coverArt}`;

/** Library artwork (fetched once per player, cover and size), or null when there is none. */
export function artUrl(player: string, coverArt: string, size: number): Promise<string | null> {
  const key = keyOf(player, coverArt, size);
  const hit = loaded.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(key);
  if (pending) return pending;

  const p = fetchImage(`/api/art?id=${encodeURIComponent(coverArt)}&size=${size}`).then((url) => {
    loading.delete(key);
    if (url) loaded.set(key, url);
    return url;
  });

  loading.set(key, p);
  return p;
}

/** Already loaded artwork, so it can show without waiting. */
export const cachedArtUrl = (player: string, coverArt: string, size: number): string | undefined =>
  loaded.get(keyOf(player, coverArt, size));
