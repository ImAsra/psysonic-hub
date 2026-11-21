import type { LibraryItem } from '../types.ts';
import { joinMeta } from '../utils/joinMeta.ts';
import type { DetailKind } from './libraryView.ts';

/** The line under a detail page's title: artist and year for an album, song count for a playlist. */
export function detailSubtitle(
  kind: DetailKind,
  item: LibraryItem | undefined,
  songCount: (n: number) => string,
): string {
  if (kind === 'album') return joinMeta(item?.artist, item?.year);
  if (kind === 'playlist' && item?.songCount) return songCount(item.songCount);
  return '';
}
