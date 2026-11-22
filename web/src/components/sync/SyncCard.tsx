import { useTranslation } from 'react-i18next';

import { STORAGE } from '../../constants.ts';
import { useStoredToggle } from '../../hooks/useStoredToggle.ts';
import { useHubStore } from '../../store/useHubStore.ts';
import { SyncRow } from './SyncRow.tsx';

export function SyncCard() {
  const { t } = useTranslation();
  const catalog = useHubStore((s) => s.catalog);
  const config = useHubStore((s) => s.syncConfig);
  const [open, setOpen] = useStoredToggle(STORAGE.syncOpen, true);

  if (!catalog.length) return null;
  return (
    <details id="syncCard" className="card" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('settings.sync')}</summary>
      <div className="sub sync-intro">{t('settings.syncIntro')}</div>
      <div id="syncList">
        {catalog.map((c) => (
          <SyncRow key={c.id} id={c.id} enabled={config[c.id] === true} />
        ))}
      </div>
    </details>
  );
}
