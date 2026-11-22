import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { hub } from '../../hub/HubConnection.ts';
import { useHubStore } from '../../store/useHubStore.ts';

export function Transport() {
  const { t } = useTranslation();
  const playing = useHubStore((s) => !!s.state?.playing);

  return (
    <div className="transport">
      <button className="icon-btn" type="button" aria-label={t('player.previous')} onClick={() => hub.command('prev')}>
        <SkipBack fill="currentColor" />
      </button>
      <button
        className="icon-btn main"
        type="button"
        aria-label={t('player.toggle')}
        onClick={() => hub.command('toggle')}
      >
        {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
      <button className="icon-btn" type="button" aria-label={t('player.next')} onClick={() => hub.command('next')}>
        <SkipForward fill="currentColor" />
      </button>
    </div>
  );
}
