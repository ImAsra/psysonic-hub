// Every constant the web remote uses.

export const STORAGE = {
  deviceId: 'deviceId',
  token: 'token',
  locale: 'locale',
  libTab: 'libTab',
  albumSort: 'albumSort',
  syncOpen: 'psysonic-hub:syncOpen',
} as const;

export const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Español'],
  ['de', 'Deutsch'],
  ['nl', 'Nederlands'],
  ['bg', 'Български'],
  ['el', 'Ελληνικά'],
  ['fr', 'Français'],
  ['hu', 'Magyar'],
  ['it', 'Italiano'],
  ['ja', '日本語'],
  ['nb', 'Norsk bokmål'],
  ['pl', 'Polski'],
  ['ro', 'Română'],
  ['ru', 'Русский'],
  ['uk', 'Українська'],
  ['zh', '简体中文'],
] as const;

/** Reconnect after 1, 2, 4, 8 s ... capped at 15 s. */
export const RECONNECT_MAX_MS = 15_000;
/** While a slider is dragged, at most one volume command per this many ms. */
export const VOLUME_THROTTLE_MS = 100;
/** The seek bar redraws this often while playing. */
export const PROGRESS_TICK_MS = 250;
/** A browse request the hub never answers is given up after this long. */
export const BROWSE_TIMEOUT_MS = 20_000;
/** The current cover is uploaded a moment after the track starts: retry this many times, this far apart. */
export const COVER_RETRIES = 4;
export const COVER_RETRY_MS = 1200;

/** The section under this line (px from the top of the window) is the one the letter index highlights. */
export const ACTIVE_LETTER_LINE = 120;
/** A jump to a letter loads at most this many further pages to reach it. */
export const MAX_JUMP_PAGES = 100;

export const ART_THUMB = 96;
export const ART_TILE = 300;

export const ALBUM_SORTS = ['newest', 'recent', 'frequent', 'random', 'alphabeticalByName', 'starred'] as const;
export const ALBUM_SORT_LABELS: Record<(typeof ALBUM_SORTS)[number], string> = {
  newest: 'library.sort.newest',
  recent: 'library.sort.recent',
  frequent: 'library.sort.frequent',
  random: 'library.sort.random',
  alphabeticalByName: 'library.sort.name',
  starred: 'library.sort.starred',
};
export const LIBRARY_TABS = ['albums', 'artists', 'playlists'] as const;
