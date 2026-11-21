import { SyncCard } from '../sync/SyncCard.tsx';
import { ConnectCard } from './ConnectCard.tsx';

export function SettingsPage() {
  return (
    <>
      <ConnectCard />
      <SyncCard />
    </>
  );
}
