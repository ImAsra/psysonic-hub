import type { LibraryTab } from '../types.ts';
import type { LibraryView } from './libraryView.ts';

/** The class naming what the library card shows (decides which navigation rows are visible). */
export function libraryViewClass(view: LibraryView, tab: LibraryTab): string {
  if (view.kind === 'tab') return `libview-${tab}`;
  if (view.kind === 'search') return 'libview-search';
  return 'libview-detail';
}
