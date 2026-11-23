import type { LucideIcon } from 'lucide-react';

import { ART_TILE } from '../../constants.ts';
import { ArtImage } from './ArtImage.tsx';

/** The first letter of a name, shown where an artist has no picture. */
const initialOf = (name?: string) => [...(name ?? '').trim()][0]?.toLocaleUpperCase() ?? '';

/** A button shown over the artwork on hover, e.g. play or add to queue. */
export interface TileAction {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Fills the icon (the play triangle, as in Psysonic). */
  filled?: boolean;
}

/** An artwork tile with two lines under it: square for albums, round and centred for artists. */
export function Tile({
  l1,
  l2,
  coverArt,
  round,
  onClick,
  actions,
}: {
  l1?: string;
  l2?: string;
  coverArt?: string;
  round?: boolean;
  onClick: () => void;
  actions?: TileAction[];
}) {
  const tile = (
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
  if (!actions?.length) return tile;

  // The buttons sit beside the tile's own button (buttons cannot nest), laid over its artwork.
  return (
    <div className="tile-box">
      {tile}
      <div className="tile-actions">
        {actions.map(({ icon: Icon, label, onClick: act, filled }) => (
          <button key={label} type="button" className="tile-action" aria-label={label} title={label} onClick={act}>
            <Icon size={15} fill={filled ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
