import { useTranslation } from 'react-i18next';

import { ART_TILE } from '../../constants.ts';
import { detailSubtitle } from '../../library/detailSubtitle.ts';
import type { DetailKind } from '../../library/libraryView.ts';
import { playItem, useLibraryStore } from '../../store/useLibraryStore.ts';
import type { LibraryItem, PlayItemMode } from '../../types.ts';
import { ArtImage } from '../common/ArtImage.tsx';

const MODES: [PlayItemMode, string, string][] = [
  ['play', 'btn', 'library.play'],
  ['next', 'btn ghost', 'library.playNext'],
  ['add', 'btn ghost', 'library.addToQueue'],
];

/** Back button, artwork, title, and the play actions of an album, artist or playlist page. */
export function DetailHeader({ kind, id, item }: { kind: DetailKind; id: string; item?: LibraryItem }) {
  const { t } = useTranslation();
  const back = useLibraryStore((s) => s.back);
  const sub = detailSubtitle(kind, item, (count) => t('library.songCount', { count }));

  return (
    <div className="lib-head">
      <button type="button" className="link-btn" onClick={() => void back()}>
        {t('library.back')}
      </button>
      <div className="lib-hero">
        {item?.coverArt && <ArtImage className="lib-art" coverArt={item.coverArt} size={ART_TILE} />}
        <div className="meta">
          <div className="title">{item?.name ?? item?.title}</div>
          <div className="artist">{sub}</div>
        </div>
      </div>
      {kind !== 'artist' && (
        <div className="lib-actions">
          {MODES.map(([mode, cls, label]) => (
            <button key={mode} type="button" className={cls} onClick={() => playItem(kind, id, mode)}>
              {t(label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
