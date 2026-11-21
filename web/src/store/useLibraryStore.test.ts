import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BrowseRequest } from '../types.ts';

const browse = vi.fn();
vi.mock('../hub/HubConnection.ts', () => ({ hub: { browse: (...a: unknown[]) => browse(...a), commandTo: vi.fn() } }));

const { useLibraryStore } = await import('./useLibraryStore.ts');
const { mergePage } = await import('../library/mergePage.ts');
const { tabRequest } = await import('../library/tabRequest.ts');
const { libraryPlayerOf } = await import('../library/libraryPlayerOf.ts');
const { useHubStore } = await import('./useHubStore.ts');

const albums = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `al${from + i}` }));

describe('library browsing', () => {
  beforeEach(() => {
    browse.mockReset();
    useHubStore.setState({ devices: [{ id: 'desk', name: 'Desk', kind: 'desktop', active: true, server: [] }] });
    useLibraryStore.setState({ view: { kind: 'tab' }, stack: [], result: null, offset: 0, more: false, message: '' });
  });

  it('loading more albums continues after the ones shown and appends them', async () => {
    browse.mockResolvedValueOnce({ result: { albums: albums(0, 40), more: true } });
    await useLibraryStore.getState().showTab('albums');
    browse.mockResolvedValueOnce({ result: { albums: albums(40, 10), more: false } });
    await useLibraryStore.getState().loadMore();

    expect(browse.mock.calls[1][1]).toMatchObject({ kind: 'albums', offset: 40 });
    const s = useLibraryStore.getState();
    expect(s.result?.albums).toHaveLength(50);
    expect(s.more).toBe(false);
  });

  it('back from an album opened from search results returns to those results', async () => {
    browse.mockResolvedValue({ result: { songs: [], albums: albums(0, 1) } });
    await useLibraryStore.getState().search('beat');
    await useLibraryStore.getState().open({ kind: 'album', id: 'al0' });
    await useLibraryStore.getState().back();

    expect(useLibraryStore.getState().view).toEqual({ kind: 'search', query: 'beat' });
    expect((browse.mock.calls.at(-1)![1] as BrowseRequest).kind).toBe('search');
  });

  it('back from an album opened from a tab returns to the tab', async () => {
    browse.mockResolvedValue({ result: { albums: albums(0, 1) } });
    await useLibraryStore.getState().open({ kind: 'album', id: 'al0' });
    await useLibraryStore.getState().back();
    expect(useLibraryStore.getState().view).toEqual({ kind: 'tab' });
  });

  it('an answer that arrives after the user moved on is dropped', async () => {
    let answerSlow!: (v: unknown) => void;
    browse.mockReturnValueOnce(new Promise((r) => (answerSlow = r)));
    browse.mockResolvedValueOnce({ result: { songs: [{ id: 's1' }] } });
    const slow = useLibraryStore.getState().open({ kind: 'album', id: 'slow' });
    await useLibraryStore.getState().open({ kind: 'album', id: 'fast' });
    answerSlow({ result: { songs: [{ id: 'stale' }] } });
    await slow;

    expect(useLibraryStore.getState().result?.songs).toEqual([{ id: 's1' }]);
  });

  it('an empty search goes back to the tab, and a search without hits says so', async () => {
    browse.mockResolvedValue({ result: { songs: [], albums: [], artists: [] } });
    await useLibraryStore.getState().search('zzz');
    expect(useLibraryStore.getState().message).toBe('library.noResults');
    await useLibraryStore.getState().search('   ');
    expect(useLibraryStore.getState().view).toEqual({ kind: 'tab' });
  });

  it('a failed lookup shows why', async () => {
    browse.mockResolvedValue({ error: 'timeout' });
    await useLibraryStore.getState().showTab('playlists');
    expect(useLibraryStore.getState().message).toBe('library.timeout');
  });

  it('without a player nothing is asked and the page says to open Psysonic', async () => {
    useHubStore.setState({ devices: [] });
    await useLibraryStore.getState().showTab('albums');
    expect(browse).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().message).toBe('library.noPlayer');
  });
});

describe('the library player going away', () => {
  beforeEach(() => {
    browse.mockReset();
    useHubStore.setState({ devices: [{ id: 'desk', name: 'Desk', kind: 'desktop', active: true, server: [] }] });
    useLibraryStore.setState({ playerId: 'desk', view: { kind: 'tab' }, stack: [], result: null, message: '' });
  });

  it('a lookup answered after the player left is dropped, and the same player coming back reloads', async () => {
    let answerLate!: (v: unknown) => void;
    browse.mockReturnValueOnce(new Promise((r) => (answerLate = r)));
    const pending = useLibraryStore.getState().open({ kind: 'album', id: 'al1' });

    useLibraryStore.getState().followPlayer('');
    answerLate({ error: 'player_left' });
    await pending;
    expect(useLibraryStore.getState().message).toBe('');

    browse.mockResolvedValueOnce({ result: { albums: albums(0, 3) } });
    useLibraryStore.getState().followPlayer('desk');
    await vi.waitFor(() => expect(useLibraryStore.getState().result?.albums).toHaveLength(3));
    expect(useLibraryStore.getState().message).toBe('');
  });
});

describe('libraryPlayerOf', () => {
  const desk = { id: 'desk', name: 'Desk', kind: 'desktop' as const, active: false, server: [] };
  const phone = { id: 'phone', name: 'Phone', kind: 'phone' as const, active: true, server: [] };

  it('shows the playing device, else the first one', () => {
    expect(libraryPlayerOf({ status: 'connected', devices: [desk, phone] })).toBe('phone');
    expect(libraryPlayerOf({ status: 'connected', devices: [desk] })).toBe('desk');
  });

  it('has no player while the page is not connected, so the library reloads after reconnecting', () => {
    expect(libraryPlayerOf({ status: 'reconnecting', devices: [desk, phone] })).toBe('');
    expect(libraryPlayerOf({ status: 'signedOut', devices: [desk] })).toBe('');
  });
});

describe('library helpers', () => {
  it('a tab page asks for its own kind of list', () => {
    expect(tabRequest('albums', 'recent', 40)).toEqual({ kind: 'albums', sort: 'recent', offset: 40 });
    expect(tabRequest('artists', 'recent', 200)).toEqual({ kind: 'artists', offset: 200 });
    expect(tabRequest('playlists', 'recent', 0)).toEqual({ kind: 'playlists' });
  });

  it('a further page keeps what was shown and adds the new entries after it', () => {
    const merged = mergePage({ albums: albums(0, 2) }, { albums: albums(2, 1), more: false });
    expect(merged.albums?.map((a) => a.id)).toEqual(['al0', 'al1', 'al2']);
    expect(merged.more).toBe(false);
  });
});
