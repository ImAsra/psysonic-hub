import { useTranslation } from 'react-i18next';

import { useLibraryStore } from '../../store/useLibraryStore.ts';
import type { LibraryItem } from '../../types.ts';
import { Row } from '../common/Row.tsx';

export function ArtistRows({ artists }: { artists: LibraryItem[] }) {
  const { t } = useTranslation();
  const open = useLibraryStore((s) => s.open);

  return (
    <div className="rows flat">
      {artists.map((a) => (
        <Row
          key={a.id}
          l1={a.name}
          l2={a.albumCount ? t('library.albumCount', { count: a.albumCount }) : ''}
          thumb
          round
          coverArt={a.coverArt}
          onClick={() => void open({ kind: 'artist', id: a.id })}
        />
      ))}
    </div>
  );
}
