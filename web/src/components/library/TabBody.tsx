import { useLibraryStore } from '../../store/useLibraryStore.ts';
import type { BrowseResult, LibraryTab } from '../../types.ts';
import { AlbumGrid } from './AlbumGrid.tsx';
import { ArtistGrid } from './ArtistGrid.tsx';
import { LetterIndex } from './LetterIndex.tsx';
import { PlaylistRows } from './PlaylistRows.tsx';

/** The list of a top-level tab page: artists and albums sorted by name come with a letter index. */
export function TabBody({ tab, result }: { tab: LibraryTab; result: BrowseResult }) {
  const sort = useLibraryStore((s) => s.sort);
  const albums = result.albums ?? [];

  if (tab === 'artists') {
    return <LetterIndex items={result.artists ?? []} render={(items) => <ArtistGrid artists={items} />} />;
  }

  if (tab === 'albums' && sort === 'alphabeticalByName') {
    return <LetterIndex items={albums} render={(items) => <AlbumGrid albums={items} />} />;
  }

  if (tab === 'albums') return <AlbumGrid albums={albums} />;
  return <PlaylistRows playlists={result.playlists ?? []} />;
}
