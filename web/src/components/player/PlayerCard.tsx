import { selectActiveDevice, useHubStore } from '../../store/useHubStore.ts';
import { NowPlaying } from './NowPlaying.tsx';
import { SeekBar } from './SeekBar.tsx';
import { Transport } from './Transport.tsx';
import { VolumeBar } from './VolumeBar.tsx';

/** What plays and the controls (dimmed while no device is active). */
export function PlayerCard() {
  const hasActive = useHubStore((s) => !!selectActiveDevice(s));

  return (
    <section id="main" className={hasActive ? 'card' : 'card controls-off'}>
      <NowPlaying />
      <SeekBar />
      <Transport />
      <VolumeBar />
    </section>
  );
}
