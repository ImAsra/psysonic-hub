import { useTranslation } from 'react-i18next';

import { playItem } from '../../store/useLibraryStore.ts';
import type { BrowseResult } from '../../types.ts';
import { AlbumGrid } from './AlbumGrid.tsx';
import { ArtistRows } from './ArtistRows.tsx';
import { SongRows } from './SongRows.tsx';

export function SearchResults({ result }: { result: BrowseResult }) {
  const { t } = useTranslation();

  return (
    <>
      {!!result.songs?.length && (
        <>
          <div className="lib-section">{t('library.songs')}</div>
          <SongRows songs={result.songs} withAlbum onPlay={(s) => playItem('song', s.id, 'play')} />
        </>
      )}
      {!!result.albums?.length && (
        <>
          <div className="lib-section">{t('library.albums')}</div>
          <AlbumGrid albums={result.albums} />
        </>
      )}
      {!!result.artists?.length && (
        <>
          <div className="lib-section">{t('library.artists')}</div>
          <ArtistRows artists={result.artists} />
        </>
      )}
    </>
  );
}
