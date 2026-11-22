import { useTranslation } from 'react-i18next';

import { useLibraryStore } from '../../store/useLibraryStore.ts';
import type { LibraryItem } from '../../types.ts';
import { Row } from '../common/Row.tsx';

export function PlaylistRows({ playlists }: { playlists: LibraryItem[] }) {
  const { t } = useTranslation();
  const open = useLibraryStore((s) => s.open);

  return (
    <div className="rows flat">
      {playlists.map((p) => (
        <Row
          key={p.id}
          l1={p.name}
          l2={p.songCount ? t('library.songCount', { count: p.songCount }) : ''}
          thumb
          coverArt={p.coverArt}
          onClick={() => void open({ kind: 'playlist', id: p.id })}
        />
      ))}
    </div>
  );
}
