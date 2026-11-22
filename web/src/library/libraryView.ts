export type DetailKind = 'album' | 'artist' | 'playlist';

/** What the library card shows: a tab page, an album / artist / playlist, or search results. */
export type LibraryView = { kind: 'tab' } | { kind: DetailKind; id: string } | { kind: 'search'; query: string };
