import { useRef } from 'react';

import { useArtUrl } from '../../hooks/useArtUrl.ts';

/** Library artwork, loaded once it scrolls into view (an empty tile until then). */
export function ArtImage({ coverArt, size, className }: { coverArt?: string; size: number; className: string }) {
  const ref = useRef<HTMLImageElement>(null);
  const url = useArtUrl(ref, coverArt, size);

  return <img ref={ref} className={className} src={url} alt="" />;
}
