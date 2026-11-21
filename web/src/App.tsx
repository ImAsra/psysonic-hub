import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { DevicesCard } from './components/devices/DevicesCard.tsx';
import { Header } from './components/layout/Header.tsx';
import { LibraryCard } from './components/library/LibraryCard.tsx';
import { LoginCard } from './components/login/LoginCard.tsx';
import { PlayerCard } from './components/player/PlayerCard.tsx';
import { QueueCard } from './components/queue/QueueCard.tsx';
import { SyncCard } from './components/sync/SyncCard.tsx';
import { startSession } from './hub/startSession.ts';
import { useHubStore } from './store/useHubStore.ts';

export function App() {
  const { t } = useTranslation();
  const loginVisible = useHubStore((s) => s.login.visible);
  const welcomed = useHubStore((s) => s.welcomed);

  useEffect(() => void startSession(), []);

  return (
    <main>
      <Header />
      {loginVisible && <LoginCard />}
      {!loginVisible && welcomed && (
        <>
          <PlayerCard />
          <QueueCard />
          <LibraryCard />
          <DevicesCard />
          <SyncCard />
        </>
      )}
      <footer>{t('footer')}</footer>
    </main>
  );
}
