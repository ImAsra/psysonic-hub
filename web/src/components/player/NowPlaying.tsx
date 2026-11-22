import { useTranslation } from 'react-i18next';

import { useHubStore } from '../../store/useHubStore.ts';
import { joinMeta } from '../../utils/joinMeta.ts';
import { NowPlayingArt } from './NowPlayingArt.tsx';
import { PlayingOn } from './PlayingOn.tsx';

export function NowPlaying() {
  const { t } = useTranslation();
  const title = useHubStore((s) => s.state?.title);
  const meta = useHubStore((s) => joinMeta(s.state?.artist, s.state?.album));

  return (
    <div className="np">
      <NowPlayingArt />
      <div className="meta">
        <div className="title">{title || t('player.nothingPlaying')}</div>
        <div className="artist">{meta || ' '}</div>
        <PlayingOn />
      </div>
    </div>
  );
}
