import { useLibraryStore } from '../../store/useLibraryStore.ts';
import type { LibraryItem } from '../../types.ts';
import { joinMeta } from '../../utils/joinMeta.ts';
import { Tile } from '../common/Tile.tsx';

export function AlbumGrid({ albums }: { albums: LibraryItem[] }) {
  const open = useLibraryStore((s) => s.open);

  return (
    <div className="grid">
      {albums.map((a) => (
        <Tile
          key={a.id}
          l1={a.name}
          l2={joinMeta(a.artist, a.year)}
          coverArt={a.coverArt}
          onClick={() => void open({ kind: 'album', id: a.id })}
        />
      ))}
    </div>
  );
}
