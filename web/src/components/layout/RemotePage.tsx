import { useHubStore } from '../../store/useHubStore.ts';
import { DevicesCard } from '../devices/DevicesCard.tsx';
import { LibraryCard } from '../library/LibraryCard.tsx';
import { PlayerCard } from '../player/PlayerCard.tsx';
import { QueueCard } from '../queue/QueueCard.tsx';
import { NoPlayersCard } from './NoPlayersCard.tsx';

/** The remote: the player, queue, library and devices, or a note while no player is connected. */
export function RemotePage() {
  const hasPlayers = useHubStore((s) => s.devices.length > 0);

  if (!hasPlayers) return <NoPlayersCard />;
  return (
    <>
      <PlayerCard />
      <QueueCard />
      <LibraryCard />
      <DevicesCard />
    </>
  );
}
