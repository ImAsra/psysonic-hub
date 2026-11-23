import { useHubStore } from '../../store/useHubStore.ts';
import { DevicesCard } from '../devices/DevicesCard.tsx';
import { LibraryCard } from '../library/LibraryCard.tsx';
import { PlayerCard } from '../player/PlayerCard.tsx';
import { QueueCard } from '../queue/QueueCard.tsx';
import { NoPlayersCard } from './NoPlayersCard.tsx';

/**
 * The remote: the player, queue, devices and library, or a note while no player is connected.
 * This is the order on a phone; wider screens place the cards in a grid (layout.css).
 */
export function RemotePage() {
  const hasPlayers = useHubStore((s) => s.devices.length > 0);

  if (!hasPlayers) return <NoPlayersCard />;
  return (
    <>
      <PlayerCard />
      <QueueCard />
      <DevicesCard />
      <LibraryCard />
    </>
  );
}
