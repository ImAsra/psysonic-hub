import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hub/HubConnection.ts', () => ({ hub: { browse: vi.fn(), commandTo: vi.fn() } }));

const { SearchResults } = await import('./SearchResults.tsx');

describe('search results', () => {
  it('show albums first, then songs, then artists', () => {
    const { container } = render(
      <SearchResults
        result={{
          songs: [{ id: 's1', title: 'Song 1' }],
          albums: [{ id: 'al1', name: 'Album 1' }],
          artists: [{ id: 'ar1', name: 'Band 1' }],
        }}
      />,
    );
    const sections = [...container.querySelectorAll('.lib-section')].map((e) => e.textContent);
    expect(sections).toEqual(['library.albums', 'library.songs', 'library.artists']);
  });
});
