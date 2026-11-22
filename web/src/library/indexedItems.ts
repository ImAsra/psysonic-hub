import type { LibraryItem, LibraryTab, RemoteAlbumSort } from '../types.ts';
import type { LibraryView } from './libraryView.ts';

interface Page {
  view: LibraryView;
  tab: LibraryTab;
  sort: RemoteAlbumSort;
  result: { albums?: LibraryItem[]; artists?: LibraryItem[] } | null;
}

/** The list the letter index runs over: the artists, or the albums sorted by name; null on other pages. */
export function indexedItems({ view, tab, sort, result }: Page): LibraryItem[] | null {
  if (view.kind !== 'tab') return null;
  if (tab === 'artists') return result?.artists ?? [];
  if (tab === 'albums' && sort === 'alphabeticalByName') return result?.albums ?? [];
  return null;
}
