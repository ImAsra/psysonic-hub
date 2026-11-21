import type { LibraryView } from '../../library/libraryView.ts';
import { playItem } from '../../store/useLibraryStore.ts';
import type { BrowseResult } from '../../types.ts';
import { AlbumGrid } from './AlbumGrid.tsx';
import { SongRows } from './SongRows.tsx';

type Detail = Extract<LibraryView, { id: string }>;

/** An artist's albums, or an album's / playlist's songs (tapping one plays from there). */
export function DetailBody({ view, result }: { view: Detail; result: BrowseResult }) {
  const { kind, id } = view;
  if (kind === 'artist') return <AlbumGrid albums={result.albums ?? []} />;

  return (
    <SongRows
      songs={result.songs ?? []}
      withAlbum={kind === 'playlist'}
      onPlay={(_, i) => playItem(kind, id, 'play', i)}
    />
  );
}
