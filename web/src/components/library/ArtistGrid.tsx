import { useTranslation } from 'react-i18next';

import { useLibraryStore } from '../../store/useLibraryStore.ts';
import type { LibraryItem } from '../../types.ts';
import { Tile } from '../common/Tile.tsx';

/** Artists as round picture tiles. */
export function ArtistGrid({ artists }: { artists: LibraryItem[] }) {
  const { t } = useTranslation();
  const open = useLibraryStore((s) => s.open);

  return (
    <div className="grid">
      {artists.map((a) => (
        <Tile
          key={a.id}
          l1={a.name}
          l2={a.albumCount ? t('library.albumCount', { count: a.albumCount }) : ''}
          coverArt={a.coverArt}
          round
          onClick={() => void open({ kind: 'artist', id: a.id })}
        />
      ))}
    </div>
  );
}
