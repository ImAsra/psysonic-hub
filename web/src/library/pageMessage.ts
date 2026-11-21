import type { BrowseRequest, BrowseResult } from '../types.ts';
import { isTabRequest } from './isTabRequest.ts';
import { pageCount } from './pageCount.ts';

const noHits = (page: BrowseResult) => !page.songs?.length && !page.albums?.length && !page.artists?.length;

/** The message under a page that loaded (translation key, '' = none): an empty list or a search without hits. */
export function pageMessage(req: BrowseRequest, page: BrowseResult, append: boolean): string {
  if (isTabRequest(req) && !append && pageCount(page) === 0) return 'library.empty';
  if (req.kind === 'search' && noHits(page)) return 'library.noResults';
  return '';
}
