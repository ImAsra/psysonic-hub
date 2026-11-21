import { fetchImage } from './fetchImage.ts';

// Library artwork stays loaded for the whole visit: object URLs by "size:coverArt".
const loaded = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();

/** Library artwork (fetched once per cover and size), or null when there is none. */
export function artUrl(coverArt: string, size: number): Promise<string | null> {
  const key = `${size}:${coverArt}`;
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
export const cachedArtUrl = (coverArt: string, size: number): string | undefined => loaded.get(`${size}:${coverArt}`);
