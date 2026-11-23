import { create } from 'zustand';

import { ALBUM_SORTS, LIBRARY_TABS, MAX_JUMP_PAGES, STORAGE } from '../constants.ts';
import { hub } from '../hub/HubConnection.ts';
import { errorMessage } from '../library/errorMessage.ts';
import { indexedItems } from '../library/indexedItems.ts';
import { isTabRequest } from '../library/isTabRequest.ts';
import { letterRank } from '../library/letterRank.ts';
import { letterSections } from '../library/letterSections.ts';
import type { LibraryView } from '../library/libraryView.ts';
import { mergePage } from '../library/mergePage.ts';
import { pageCount } from '../library/pageCount.ts';
import { pageMessage } from '../library/pageMessage.ts';
import { tabRequest } from '../library/tabRequest.ts';
import type { BrowseRequest, BrowseResult, LibraryTab, PlayItemKind, PlayItemMode, RemoteAlbumSort } from '../types.ts';
import { storage } from '../utils/storage.ts';
import { useHubStore } from './useHubStore.ts';

export interface LibraryState {
  tab: LibraryTab;
  sort: RemoteAlbumSort;
  view: LibraryView;
  /** Views to go back to (detail pages opened from other pages). */
  stack: LibraryView[];
  result: BrowseResult | null;
  loading: boolean;
  /** Translation key of the message under the list ('' = none). */
  message: string;
  offset: number;
  more: boolean;
  /** The player whose library is shown. */
  playerId: string;
  /** What is typed in the search box (cleared when a tab page opens). */
  query: string;
  /** Updates the search box; emptying it while search results show goes back to the tab. */
  setQuery: (query: string) => Promise<void>;
  showTab: (tab: LibraryTab) => Promise<void>;
  setSort: (sort: RemoteAlbumSort) => Promise<void>;
  loadMore: () => Promise<void>;
  /** Loads further pages of an indexed list until a letter (or a later one) is in, or the list ends. */
  loadThrough: (letter: string) => Promise<void>;
  open: (view: LibraryView, remember?: boolean) => Promise<void>;
  back: () => Promise<void>;
  search: (query: string) => Promise<void>;
  /** Follows the player that answers lookups: reloads the top level when it changes. */
  followPlayer: (playerId: string) => void;
}

const savedTab = storage.get(STORAGE.libTab) as LibraryTab | null;
const savedSort = storage.get(STORAGE.albumSort) as RemoteAlbumSort | null;
let requestSeq = 0;

/** The player that answers lookups and plays what is picked: the active one, else the first. */
export const libraryPlayerId = (): string | undefined => {
  const { devices } = useHubStore.getState();
  return (devices.find((d) => d.active) ?? devices[0])?.id;
};

/** Plays, plays next or queues an album, playlist or song on the library's player. */
export function playItem(kind: PlayItemKind, id: string, mode: PlayItemMode, index?: number): void {
  const to = libraryPlayerId();
  if (to) hub.commandTo(to, 'playItem', { kind, id, mode, index });
}

export const useLibraryStore = create<LibraryState>()((set, get) => {
  /** Runs a lookup; the answer is dropped when the user moved on meanwhile. */
  async function load(req: BrowseRequest, append: boolean) {
    const to = libraryPlayerId();
    const seq = ++requestSeq;

    set(
      append
        ? { loading: true, message: 'library.loading' }
        : { loading: true, message: 'library.loading', result: null, more: false },
    );

    const answer = to ? await hub.browse(to, req) : { error: 'no_player' };
    if (seq !== requestSeq) return;

    if (answer.error || !answer.result) {
      set({ loading: false, message: errorMessage(answer.error ?? 'bad_result') });
      return;
    }

    const page = answer.result;

    set({
      loading: false,
      result: append ? mergePage(get().result, page) : page,
      message: pageMessage(req, page, append),
      offset: isTabRequest(req) ? get().offset + pageCount(page) : 0,
      more: page.more === true,
    });
  }

  return {
    tab: savedTab && (LIBRARY_TABS as readonly string[]).includes(savedTab) ? savedTab : 'albums',
    sort: savedSort && (ALBUM_SORTS as readonly string[]).includes(savedSort) ? savedSort : 'newest',
    view: { kind: 'tab' },
    stack: [],
    result: null,
    loading: false,
    message: '',
    offset: 0,
    more: false,
    playerId: '',
    query: '',

    async setQuery(query) {
      set({ query });
      if (!query.trim() && get().view.kind === 'search') await get().search('');
    },

    async showTab(tab) {
      storage.set(STORAGE.libTab, tab);
      set({ tab, view: { kind: 'tab' }, stack: [], offset: 0, query: '' });
      await load(tabRequest(tab, get().sort, 0), false);
    },
    async setSort(sort) {
      storage.set(STORAGE.albumSort, sort);
      set({ sort });
      await get().showTab('albums');
    },
    async loadMore() {
      const { tab, sort, offset, view } = get();
      if (view.kind !== 'tab') return;
      await load(tabRequest(tab, sort, offset), true);
    },
    async loadThrough(letter) {
      const { tab, sort } = get();
      const target = letterRank(letter);

      for (let i = 0; i < MAX_JUMP_PAGES; i++) {
        const s = get();
        const items = indexedItems(s);
        if (!items || !s.more || s.tab !== tab || s.sort !== sort) return;

        const loaded = letterSections(items, (item) => item.name).map((section) => section.letter);
        if (loaded.includes(letter) || letterRank(loaded.at(-1) ?? '#') > target) return;

        const before = s.offset;
        await get().loadMore();
        if (get().offset === before) return; // the page didn't come (an error, or the user moved on)
      }
    },
    async open(view, remember = true) {
      const { view: current, stack } = get();
      set({ view, stack: remember && current.kind !== 'tab' ? [...stack, current] : stack });
      if (view.kind === 'tab') return get().showTab(get().tab);
      if (view.kind === 'search') return load({ kind: 'search', query: view.query }, false);
      return load({ kind: view.kind, id: view.id }, false);
    },
    async back() {
      const stack = [...get().stack];
      const prev = stack.pop();
      set({ stack });
      await get().open(prev ?? { kind: 'tab' }, false);
    },
    async search(query) {
      const q = query.trim();
      set({ stack: [] });
      if (!q) return get().showTab(get().tab);
      await get().open({ kind: 'search', query: q }, false);
    },
    followPlayer(playerId) {
      if (playerId === get().playerId) return;

      if (!playerId) {
        // No player: drop what is still loading, and reload when one comes back, even the same one.
        requestSeq++;
        set({ playerId: '', loading: false, message: '' });
        return;
      }

      set({ playerId, stack: [] });
      void get().showTab(get().tab);
    },
  };
});
