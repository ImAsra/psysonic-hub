import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PROGRESS_TICK_MS } from '../../constants.ts';
import { useNow } from '../../hooks/useNow.ts';
import { hub } from '../../hub/HubConnection.ts';
import { useHubStore } from '../../store/useHubStore.ts';
import { formatTime } from '../../utils/formatTime.ts';
import { playbackPosition } from '../../utils/playbackPosition.ts';
import { RangeSlider } from '../common/RangeSlider.tsx';

export function SeekBar() {
  const { t } = useTranslation();
  const state = useHubStore((s) => s.state);
  const stateAt = useHubStore((s) => s.stateAt);
  const [dragging, setDragging] = useState<number | null>(null);
  const now = useNow(PROGRESS_TICK_MS, !!state?.playing && dragging === null);
  const duration = state?.durationSec || 0;
  const position = dragging ?? playbackPosition(state, stateAt, now);

  const commit = (sec: number) => {
    hub.command('seek', { positionSec: sec });
    // Show the new position right away instead of waiting for the player's report.
    if (state) useHubStore.setState({ state: { ...state, positionSec: sec }, stateAt: Date.now() });
    setDragging(null);
  };

  return (
    <>
      <RangeSlider
        id="seek"
        value={position}
        max={duration || 1}
        step={1}
        label={t('player.seek')}
        onInput={setDragging}
        onCommit={commit}
      />
      <div className="times">
        <span>{formatTime(position)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </>
  );
}
