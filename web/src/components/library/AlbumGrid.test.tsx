import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commandTo = vi.fn();
const browse = vi.fn();

vi.mock('../../hub/HubConnection.ts', () => ({
  hub: { browse: (...a: unknown[]) => browse(...a), commandTo: (...a: unknown[]) => commandTo(...a) },
}));

const { AlbumGrid } = await import('./AlbumGrid.tsx');
const { useHubStore } = await import('../../store/useHubStore.ts');
const { useLibraryStore } = await import('../../store/useLibraryStore.ts');

const albums = [{ id: 'al1', name: 'Album 1', artist: 'Band 1' }];

describe('album tiles', () => {
  beforeEach(() => {
    commandTo.mockReset();
    browse.mockReset().mockResolvedValue({ result: { item: albums[0], songs: [] } });
    useHubStore.setState({ devices: [{ id: 'desk', name: 'Desk', kind: 'desktop', active: true, server: [] }] });
    useLibraryStore.setState({ view: { kind: 'tab' }, stack: [], result: null });
  });

  afterEach(cleanup);

  it('the play button plays the album without opening it', () => {
    const { getByLabelText } = render(<AlbumGrid albums={albums} />);
    fireEvent.click(getByLabelText('library.play'));

    expect(commandTo).toHaveBeenCalledWith('desk', 'playItem', {
      kind: 'album',
      id: 'al1',
      mode: 'play',
      index: undefined,
    });

    expect(useLibraryStore.getState().view).toEqual({ kind: 'tab' });
  });

  it('the queue button adds the album to the queue', () => {
    const { getByLabelText } = render(<AlbumGrid albums={albums} />);
    fireEvent.click(getByLabelText('library.addToQueue'));

    expect(commandTo).toHaveBeenCalledWith('desk', 'playItem', {
      kind: 'album',
      id: 'al1',
      mode: 'add',
      index: undefined,
    });
  });

  it('clicking the tile itself opens the album', () => {
    const { getByText } = render(<AlbumGrid albums={albums} />);
    fireEvent.click(getByText('Album 1'));
    expect(commandTo).not.toHaveBeenCalled();
    expect(useLibraryStore.getState().view).toEqual({ kind: 'album', id: 'al1' });
  });
});
