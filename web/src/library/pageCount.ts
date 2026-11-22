import type { BrowseResult } from '../types.ts';

/** How many entries a page of a top-level list held. */
export function pageCount(r: BrowseResult): number {
  return (r.albums ?? r.artists ?? r.playlists ?? []).length;
}
