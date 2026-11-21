import { useTranslation } from 'react-i18next';

import { ALBUM_SORT_LABELS, ALBUM_SORTS, LIBRARY_TABS } from '../../constants.ts';
import { useLibraryStore } from '../../store/useLibraryStore.ts';

/** Albums / Artists / Playlists, plus the album sort order on the Albums tab. */
export function LibraryNav() {
  const { t } = useTranslation();
  const tab = useLibraryStore((s) => s.tab);
  const sort = useLibraryStore((s) => s.sort);
  const showTab = useLibraryStore((s) => s.showTab);
  const setSort = useLibraryStore((s) => s.setSort);

  return (
    <>
      <div id="libTabs" className="chips">
        {LIBRARY_TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={id === tab ? 'chip-btn on' : 'chip-btn'}
            onClick={() => void showTab(id)}
          >
            {t(`library.${id}`)}
          </button>
        ))}
      </div>
      <div id="albumSorts" className="chips small">
        {ALBUM_SORTS.map((id) => (
          <button
            key={id}
            type="button"
            className={id === sort ? 'chip-btn on' : 'chip-btn'}
            onClick={() => void setSort(id)}
          >
            {t(ALBUM_SORT_LABELS[id])}
          </button>
        ))}
      </div>
    </>
  );
}
