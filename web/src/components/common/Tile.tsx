import { ART_TILE } from '../../constants.ts';
import { ArtImage } from './ArtImage.tsx';

/** A square artwork tile with two lines under it (albums). */
export function Tile({
  l1,
  l2,
  coverArt,
  onClick,
}: {
  l1?: string;
  l2?: string;
  coverArt?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="tile" onClick={onClick}>
      <ArtImage className="sq" coverArt={coverArt} size={ART_TILE} />
      <div className="l1">{l1 || '—'}</div>
      <div className="l2">{l2 || ' '}</div>
    </button>
  );
}
