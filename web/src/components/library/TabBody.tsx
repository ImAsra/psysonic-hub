import type { BrowseResult, LibraryTab } from '../../types.ts';
import { AlbumGrid } from './AlbumGrid.tsx';
import { ArtistGrid } from './ArtistGrid.tsx';
import { PlaylistRows } from './PlaylistRows.tsx';

/** The list of a top-level tab page. */
export function TabBody({ tab, result }: { tab: LibraryTab; result: BrowseResult }) {
  if (tab === 'albums') return <AlbumGrid albums={result.albums ?? []} />;
  if (tab === 'artists') return <ArtistGrid artists={result.artists ?? []} />;
  return <PlaylistRows playlists={result.playlists ?? []} />;
}
