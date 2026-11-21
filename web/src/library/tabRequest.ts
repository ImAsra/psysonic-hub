import type { BrowseRequest, LibraryTab, RemoteAlbumSort } from '../types.ts';

/** The request behind a top-level tab page. */
export function tabRequest(tab: LibraryTab, sort: RemoteAlbumSort, offset: number): BrowseRequest {
  if (tab === 'albums') return { kind: 'albums', sort, offset };
  if (tab === 'artists') return { kind: 'artists', offset };
  return { kind: 'playlists' };
}
