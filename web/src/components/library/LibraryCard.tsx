import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { libraryPlayerOf } from '../../library/libraryPlayerOf.ts';
import { libraryViewClass } from '../../library/libraryViewClass.ts';
import { useHubStore } from '../../store/useHubStore.ts';
import { useLibraryStore } from '../../store/useLibraryStore.ts';
import { DetailHeader } from './DetailHeader.tsx';
import { LibraryBody } from './LibraryBody.tsx';
import { LibraryNav } from './LibraryNav.tsx';
import { SearchBox } from './SearchBox.tsx';

/** Browse and play the library of the active player (or the first one), relayed by the hub. */
export function LibraryCard() {
  const { t } = useTranslation();
  const playerId = useHubStore(libraryPlayerOf);
  const showMore = useLibraryStore((s) => s.more && s.view.kind === 'tab' && !s.loading);
  const view = useLibraryStore((s) => s.view);
  const tab = useLibraryStore((s) => s.tab);
  const result = useLibraryStore((s) => s.result);
  const message = useLibraryStore((s) => s.message);
  const followPlayer = useLibraryStore((s) => s.followPlayer);
  const loadMore = useLibraryStore((s) => s.loadMore);

  useEffect(() => followPlayer(playerId), [playerId, followPlayer]);

  if (!playerId) return null;
  return (
    <section id="libraryCard" className={`card ${libraryViewClass(view, tab)}`}>
      <h2>{t('library.title')}</h2>
      <SearchBox />
      <LibraryNav />
      {view.kind !== 'tab' && view.kind !== 'search' && (
        <DetailHeader kind={view.kind} id={view.id} item={result?.item} />
      )}
      <div id="libBody">
        <LibraryBody />
      </div>
      <div className="sub gap-top-sm">{message && t(message)}</div>
      {showMore && (
        <button type="button" className="btn ghost block" onClick={() => void loadMore()}>
          {t('library.more')}
        </button>
      )}
    </section>
  );
}
