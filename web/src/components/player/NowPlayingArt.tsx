import { Music } from 'lucide-react';

import { useCoverUrl } from '../../hooks/useCoverUrl.ts';
import { useHubStore } from '../../store/useHubStore.ts';

/** The playing track's cover, over a music note while there is none. */
export function NowPlayingArt() {
  const trackId = useHubStore((s) => s.state?.trackId);
  const cover = useCoverUrl(trackId);

  return (
    <div className="art" aria-hidden="true">
      <Music />
      {cover && <img className="cover" src={cover} alt="" />}
    </div>
  );
}
