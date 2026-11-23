import { ListPlus, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { playItem, useLibraryStore } from '../../store/useLibraryStore.ts';
import type { LibraryItem } from '../../types.ts';
import { joinMeta } from '../../utils/joinMeta.ts';
import { Tile } from '../common/Tile.tsx';

export function AlbumGrid({ albums }: { albums: LibraryItem[] }) {
  const { t } = useTranslation();
  const open = useLibraryStore((s) => s.open);

  return (
    <div className="grid">
      {albums.map((a) => (
        <Tile
          key={a.id}
          l1={a.name}
          l2={joinMeta(a.artist, a.year)}
          coverArt={a.coverArt}
          onClick={() => void open({ kind: 'album', id: a.id })}
          actions={[
            { icon: Play, label: t('library.play'), onClick: () => playItem('album', a.id, 'play'), filled: true },
            { icon: ListPlus, label: t('library.addToQueue'), onClick: () => playItem('album', a.id, 'add') },
          ]}
        />
      ))}
    </div>
  );
}
