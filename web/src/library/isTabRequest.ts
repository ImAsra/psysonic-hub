import type { BrowseRequest } from '../types.ts';

/** A request for a top-level list (albums, artists, playlists), as opposed to a page or a search. */
export function isTabRequest(req: BrowseRequest): boolean {
  return req.kind === 'albums' || req.kind === 'artists' || req.kind === 'playlists';
}
