import { Volume2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { VOLUME_THROTTLE_MS } from '../../constants.ts';
import { useThrottled } from '../../hooks/useThrottled.ts';
import { hub } from '../../hub/HubConnection.ts';
import { useHubStore } from '../../store/useHubStore.ts';
import { RangeSlider } from '../common/RangeSlider.tsx';

export function VolumeBar() {
  const { t } = useTranslation();
  const reported = useHubStore((s) => s.state?.volume);
  const [dragging, setDragging] = useState<number | null>(null);
  // While dragging, send at most one volume command per 100 ms (the hub cuts off floods).
  const send = useThrottled((volume: number) => hub.command('volume', { volume }), VOLUME_THROTTLE_MS);

  return (
    <div className="vol">
      <Volume2 aria-hidden="true" />
      <RangeSlider
        value={dragging ?? reported ?? 0.5}
        max={1}
        step={0.01}
        label={t('player.volume')}
        onInput={(v) => {
          setDragging(v);
          send.push(v);
        }}
        onCommit={(v) => {
          send.flush(v);
          setDragging(null);
        }}
      />
    </div>
  );
}
