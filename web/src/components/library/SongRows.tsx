import { playItem } from '../../store/useLibraryStore.ts';
import type { LibraryItem } from '../../types.ts';
import { joinMeta } from '../../utils/joinMeta.ts';
import { Row } from '../common/Row.tsx';

interface Props {
  songs: LibraryItem[];
  /** Plays the song at this position (e.g. the album from there). */
  onPlay: (song: LibraryItem, index: number) => void;
  /** Mixed songs (playlists, search): artwork and album instead of track numbers. */
  withAlbum?: boolean;
}

export function SongRows({ songs, onPlay, withAlbum }: Props) {
  return (
    <div className="rows flat">
      {songs.map((s, i) => (
        <Row
          key={`${i}:${s.id}`}
          num={withAlbum ? undefined : s.track || i + 1}
          thumb={withAlbum}
          coverArt={s.coverArt}
          l1={s.title}
          l2={withAlbum ? joinMeta(s.artist, s.album) : s.artist}
          durationSec={s.durationSec}
          onClick={() => onPlay(s, i)}
          onAdd={() => playItem('song', s.id, 'add')}
        />
      ))}
    </div>
  );
}
