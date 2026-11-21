import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { DevicesCard } from './components/devices/DevicesCard.tsx';
import { Header } from './components/layout/Header.tsx';
import { LibraryCard } from './components/library/LibraryCard.tsx';
import { LoginCard } from './components/login/LoginCard.tsx';
import { PlayerCard } from './components/player/PlayerCard.tsx';
import { QueueCard } from './components/queue/QueueCard.tsx';
import { SettingsPage } from './components/settings/SettingsPage.tsx';
import { startSession } from './hub/startSession.ts';
import { useHubStore } from './store/useHubStore.ts';

export function App() {
  const { t } = useTranslation();
  const loginVisible = useHubStore((s) => s.login.visible);
  const welcomed = useHubStore((s) => s.welcomed);
  const page = useHubStore((s) => s.page);

  useEffect(() => void startSession(), []);

  return (
    <main className={`page-${page}`}>
      <Header />
      {loginVisible && <LoginCard />}
      {!loginVisible && welcomed && page === 'remote' && (
        <>
          <PlayerCard />
          <QueueCard />
          <LibraryCard />
          <DevicesCard />
        </>
      )}
      {!loginVisible && welcomed && page === 'settings' && <SettingsPage />}
      <footer>{t('footer')}</footer>
    </main>
  );
}
