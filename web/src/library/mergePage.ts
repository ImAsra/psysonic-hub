import type { BrowseResult } from '../types.ts';

/** Appends a further page of a list to what is shown. */
export function mergePage(prev: BrowseResult | null, page: BrowseResult): BrowseResult {
  if (!prev) return page;

  return {
    ...page,
    albums: page.albums ? [...(prev.albums ?? []), ...page.albums] : prev.albums,
    artists: page.artists ? [...(prev.artists ?? []), ...page.artists] : prev.artists,
  };
}
