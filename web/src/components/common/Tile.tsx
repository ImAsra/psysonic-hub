import { ART_TILE } from '../../constants.ts';
import { ArtImage } from './ArtImage.tsx';

/** The first letter of a name, shown where an artist has no picture. */
const initialOf = (name?: string) => [...(name ?? '').trim()][0]?.toLocaleUpperCase() ?? '';

/** An artwork tile with two lines under it: square for albums, round and centred for artists. */
export function Tile({
  l1,
  l2,
  coverArt,
  round,
  onClick,
}: {
  l1?: string;
  l2?: string;
  coverArt?: string;
  round?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={round ? 'tile round' : 'tile'} onClick={onClick}>
      <div className="sq-wrap">
        {round && (
          <span className="initial" aria-hidden="true">
            {initialOf(l1)}
          </span>
        )}
        <ArtImage className="sq" coverArt={coverArt} size={ART_TILE} />
      </div>
      <div className="l1">{l1 || '—'}</div>
      <div className="l2">{l2 || ' '}</div>
    </button>
  );
}
